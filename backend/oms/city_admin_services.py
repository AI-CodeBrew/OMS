"""Super admin's city list - the one list of city names every order's city
must match before it can be Approved (see approval_checks). Platform-wide,
not per store: built from the couriers' own city lists plus anything added
by hand."""

import logging

from django.db.models import Q

from .approval_checks import city_key
from .models import City

logger = logging.getLogger(__name__)

MAX_LIST = 2000


class CityAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _row(city):
    return {"id": city.id, "name": city.name, "source": city.source, "created_at": city.created_at}


def list_cities(q=""):
    qs = City.objects.order_by("name")
    q = (q or "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(name_key__icontains=city_key(q)))
    return {"count": City.objects.count(), "cities": [_row(c) for c in qs[:MAX_LIST]]}


def add_cities(names, *, source="manual"):
    """Adds every name not already on the list (compared by city_key).
    Returns how many were new."""
    seen = set(City.objects.values_list("name_key", flat=True))
    new = []
    for raw in names:
        name = " ".join(str(raw or "").split())
        key = city_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        new.append(City(name=name[:100], name_key=key[:100], source=source))
    City.objects.bulk_create(new)
    return len(new)


def delete_city(city_id):
    deleted, _ = City.objects.filter(id=city_id).delete()
    if not deleted:
        raise CityAdminError("City not found.", 404)


def import_from_couriers():
    """Pulls the city lists of every courier OMS can read one from - PostEx's
    operational cities and BarqRaftar's cities, through any connected
    account (a store's or FynkTech's own) - and adds the new names.
    Returns {"added": {courier: n}, "errors": {courier: message}}."""
    added, errors = {}, {}

    from integrations.postex import client as postex_client
    from integrations.postex.models import PostExConnection

    postex_names, postex_error = None, "No PostEx account is connected."
    for connection in PostExConnection.all_objects.exclude(api_token=""):
        try:
            rows = postex_client.fetch_operational_cities(connection.api_token)
        except Exception as exc:  # one bad token shouldn't stop the others
            postex_error = f"PostEx: {exc}"
            continue
        postex_names = [
            str(r.get("operationalCityName") or "").title()
            for r in rows
            if r.get("isDeliveryCity", True)
        ]
        break
    if postex_names is not None:
        added["PostEx"] = add_cities(postex_names, source="postex")
    else:
        errors["PostEx"] = postex_error

    from integrations.barqraftar import services as barqraftar_services
    from integrations.barqraftar.models import BarqRaftarConnection

    barq_names, barq_error = None, "No BarqRaftar account is connected."
    for connection in BarqRaftarConnection.all_objects.exclude(api_key=""):
        try:
            cities = barqraftar_services.get_cities(connection)
        except Exception as exc:
            barq_error = f"BarqRaftar: {exc}"
            continue
        if cities:
            barq_names = [c["name"] for c in cities]
            break
    if barq_names is not None:
        added["BarqRaftar"] = add_cities(barq_names, source="barqraftar")
    else:
        errors["BarqRaftar"] = barq_error

    logger.info("city import: added %s, errors %s", added, errors)
    return {"added": added, "errors": errors}
