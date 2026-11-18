"""What an order must get right before it may move to Approved - so
everything sitting in Approved is fit to dispatch, and a technical glitch
(a lost payment update, a half-synced address) stops the order here instead
of reaching a courier. services.approve_order runs these; any problem keeps
the order where it is, with the problems as the error.
"""

import re
from decimal import Decimal

PHONE_DIGITS = 11
# Whether an order's city must be on the super admin's city list (Cities
# page, filled from PostEx's and BarqRaftar's own city lists) to be
# Approved. An order failing only this goes to City Issue instead (see
# services.acknowledge_order).
CHECK_CITY = True


# Country codes a customer may type in front of a local number - Pakistan's
# own, and India's, which a checkout's country picker often fills in by
# mistake.
_COUNTRY_CODES = ("92", "91")


def normalize_phone(raw):
    """Digits only, as the local 11-digit number - "+92 305-4094932",
    "0092 305...", "+92 0305...", "+91 305...", "923054094932" and
    "3054094932" all -> "03054094932". A number that can't be read as one
    comes back as its leftover digits (never 11 of them), so the length
    check refuses it."""
    digits = re.sub(r"\D", "", raw or "")
    # Already local (0 + 10 digits) - kept as is, so an area code like
    # Peshawar's 091 is never mistaken for a country code.
    if len(digits) == PHONE_DIGITS and digits.startswith("0") and not digits.startswith("00"):
        return digits
    local = digits.lstrip("0")
    for code in _COUNTRY_CODES:
        if local.startswith(code) and len(local.lstrip("0")) > PHONE_DIGITS - 1:
            local = local[len(code):]
            break
    local = local.lstrip("0")
    if len(local) == PHONE_DIGITS - 1:
        return "0" + local
    return local


def city_key(name):
    """How cities are compared - case, extra spaces and dots don't matter
    ("  lahore " == "Lahore"), spelling does ("LHR" != "Lahore")."""
    return " ".join((name or "").replace(".", " ").split()).casefold()


def city_problem(city):
    """Why `city` can't be Approved - None when it's on the city list
    (or the check is off). Spelling must match a courier's own; case,
    extra spaces and dots don't matter (see city_key)."""
    from .models import City

    if not CHECK_CITY:
        return None
    city = (city or "").strip()
    if not city:
        return "City is missing"
    if not City.objects.exists():
        return "The city list is empty - add the couriers' cities first"
    if not City.objects.filter(name_key=city_key(city)).exists():
        return f"City {city!r} isn't in the couriers' city list"
    return None


def approval_problems(order, *, include_city=True):
    """Everything wrong with `order` for Approved - an empty list when
    it's good to go. include_city=False leaves out the city check, for
    callers that route a bad city to City Issue instead of refusing."""
    problems = []
    if not (order.customer_name or "").strip():
        problems.append("Customer name is missing")

    phone = normalize_phone(order.customer_phone)
    if not phone:
        problems.append("Phone number is missing")
    elif len(phone) != PHONE_DIGITS:
        problems.append(f"Phone must be {PHONE_DIGITS} digits ({order.customer_phone!r} has {len(phone)})")

    address = (order.address_line1 or "").strip()
    # Any address will do - no minimum length (removed at the user's
    # request); it just can't be blank.
    if not address:
        problems.append("Address is missing")

    if include_city:
        problem = city_problem(order.city)
        if problem:
            problems.append(problem)

    prepaid = order.payment_gateway != "cod" or order.payment_status == "paid"
    receivable = order.amount_receivable
    if prepaid and receivable > Decimal("0"):
        problems.append(f"Prepaid order still shows PKR {receivable} receivable")
    problems += stock_problems(order)
    return problems


def uses_sku_list(organization_id):
    """True for an organization that keeps a product name -> SKU list
    (oms.product_skus) - only its orders are held back for stock, so stores
    that don't keep stock by SKU approve as before."""
    from core import org_group

    from .models import ProductSku

    stores = org_group.group_ids(organization_id) or [organization_id]
    return ProductSku.all_objects.filter(organization_id__in=stores).exists()


def stock_problems(order):
    """(user, 2026-11-19) An order is only Approved when every product has a
    SKU and the organization's inventory has the quantity for it - checked
    against the stock on hand (wms.services.check_order_stock, strict: a
    product with no SKU, or no warehouse, counts as not in stock). Stock is
    still only taken at booking. Organizations without a SKU list aren't
    checked (uses_sku_list)."""
    if not uses_sku_list(order.organization_id):
        return []
    from wms.services import check_order_stock

    problems = []
    for short in check_order_stock(order, strict=True):
        name = short.get("product_name") or short.get("sku") or "A product"
        if short.get("reason"):
            problems.append(f"{name}: {short['reason']}")
        else:
            label = f"{name} ({short['sku']})" if short.get("sku") else name
            problems.append(f"{label}: need {short['required']}, only {max(short['available'], 0)} in stock")
    return problems
