"""The Orders page's field filters (frontend OrderFieldFilters): OMS Order
ID, Store Order ID, Customer Name, Phone, Tracking (typed values) and Store,
City, Province, Courier (picked from a list - filter_options below gives
the choices). Organization is the existing `store` param (organization ids).

Each filter is a query param holding a JSON array. Several values in one
filter match any of them; several filters together must all match. Read by
OrderViewSet._apply_filters, so the list, the tab counts and the CSV export
all follow them."""

import json
import re

from django.db.models import Count, Func, Q, Value
from django.db.models.functions import Lower, Trim

# Filters typed in (one or more values each).
TEXT_FILTERS = ("f_oms_id", "f_store_order_id", "f_customer", "f_phone", "f_tracking")
# Filters picked from filter_options' list.
LIST_FILTERS = ("f_shop", "f_city", "f_province", "f_courier")
ALL_FILTERS = TEXT_FILTERS + LIST_FILTERS

# Picked under Province for orders whose city has no province on the super
# admin's City list; under Courier for orders with no courier yet.
UNKNOWN_PROVINCE = "Unknown"
NO_COURIER = "__none__"


def _values(params, key):
    raw = params.get(key)
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        value = raw.split(",")
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()]


def _city_norm(qs):
    # Lahore / lahore / " Lahore " are one city.
    return qs.annotate(_city_norm=Lower(Trim("city")))


def _digits(field):
    # Phone with every space, dash and + taken out.
    return Func(field, Value(r"\D"), Value(""), Value("g"), function="REGEXP_REPLACE")


def _province_keys():
    """{province: [city key, ...]} from the super admin's City list."""
    from .models import City

    keys = {}
    for name_key, province in City.objects.exclude(province="").values_list("name_key", "province"):
        keys.setdefault(province, []).append(name_key)
    return keys


def _any(conditions):
    combined = Q()
    for condition in conditions:
        combined |= condition
    return combined


def apply_field_filters(qs, params):
    oms_ids = [int(v) for v in _values(params, "f_oms_id") if v.isdigit()]
    if _values(params, "f_oms_id"):
        qs = qs.filter(supabase_order_no__in=oms_ids)

    numbers = _values(params, "f_store_order_id")
    if numbers:
        # 12787 finds #12787 and its renumbered #12787-1; the # is optional.
        conditions = []
        for number in numbers:
            pattern = rf"^#?{re.escape(number.lstrip('#'))}(-[0-9]+)?$"
            conditions += [Q(order_number__iregex=pattern), Q(original_order_number__iregex=pattern)]
        qs = qs.filter(_any(conditions))

    names = _values(params, "f_customer")
    if names:
        qs = qs.filter(_any(Q(customer_name__icontains=n) for n in names))

    phones = [re.sub(r"\D", "", p) for p in _values(params, "f_phone")]
    phones = [p for p in phones if p]
    if phones:
        # 03001234567, +923001234567 and 3001234567 are one number - match
        # on the last 10 digits.
        qs = qs.annotate(_phone_digits=_digits("customer_phone"), _phone2_digits=_digits("secondary_phone"))
        conditions = []
        for phone in phones:
            tail = phone[-10:]
            conditions += [Q(_phone_digits__contains=tail), Q(_phone2_digits__contains=tail)]
        qs = qs.filter(_any(conditions))

    trackings = _values(params, "f_tracking")
    if trackings:
        qs = qs.filter(_any(Q(tracking_number__icontains=t) for t in trackings))

    shops = _values(params, "f_shop")
    if shops:
        qs = qs.filter(shop__in=shops)

    cities = [c.lower() for c in _values(params, "f_city")]
    provinces = _values(params, "f_province")
    if cities or provinces:
        qs = _city_norm(qs)
    if cities:
        qs = qs.filter(_city_norm__in=cities)
    if provinces:
        by_province = _province_keys()
        conditions = [
            Q(_city_norm__in=by_province.get(p, [])) for p in provinces if p != UNKNOWN_PROVINCE
        ]
        if UNKNOWN_PROVINCE in provinces:
            known = [key for keys in by_province.values() for key in keys]
            conditions.append(~Q(_city_norm__in=known))
        qs = qs.filter(_any(conditions))

    couriers = _values(params, "f_courier")
    if couriers:
        conditions = [Q(courier__name__in=[c for c in couriers if c != NO_COURIER])]
        if NO_COURIER in couriers:
            conditions.append(Q(courier__isnull=True))
        qs = qs.filter(_any(conditions))

    return qs


OPTION_FIELDS = ("f_shop", "f_city", "f_province", "f_courier")
OPTION_LIMIT = 300


def filter_options(qs, field, q=""):
    """[{value, label, count}] for one list filter, over `qs` (the orders
    the page shows with every other filter applied), most orders first.
    Returns (rows, truncated)."""
    q = (q or "").strip().lower()
    if field == "f_shop":
        rows = [
            {"value": r["shop"], "label": r["shop"] or "(No store)", "count": r["n"]}
            for r in qs.order_by().values("shop").annotate(n=Count("id"))
            if r["shop"]
        ]
    elif field == "f_courier":
        rows = [
            {
                "value": r["courier__name"] or NO_COURIER,
                "label": r["courier__name"] or "No Courier",
                "count": r["n"],
            }
            for r in qs.order_by().values("courier__name").annotate(n=Count("id"))
        ]
    elif field in ("f_city", "f_province"):
        city_rows = _city_norm(qs).order_by().values("_city_norm").annotate(n=Count("id"))
        if field == "f_city":
            rows = [
                {"value": r["_city_norm"], "label": r["_city_norm"].title(), "count": r["n"]}
                for r in city_rows
                if r["_city_norm"]
            ]
        else:
            province_of = {
                key: province for province, keys in _province_keys().items() for key in keys
            }
            totals = {}
            for r in city_rows:
                province = province_of.get(r["_city_norm"] or "", UNKNOWN_PROVINCE)
                totals[province] = totals.get(province, 0) + r["n"]
            rows = [{"value": p, "label": p, "count": n} for p, n in totals.items()]
    else:
        return [], False
    if q:
        rows = [r for r in rows if q in r["label"].lower()]
    rows.sort(key=lambda r: (-r["count"], r["label"].lower()))
    return rows[:OPTION_LIMIT], len(rows) > OPTION_LIMIT
