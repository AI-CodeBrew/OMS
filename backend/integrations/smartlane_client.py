import logging
import time

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://gcp.smartlane.dev/api/consignment"

# Per Smartlane's API doc v1.2, the load sheet is generated for one
# courier at a time - these are the courier codes their API recognises.
# Only Leopards is confirmed available; the rest mirror the CSV export's
# existing "coming soon" pattern until confirmed live on this account.
SUPPORTED_COURIERS = {"leopards"}


class SmartlaneAPIError(Exception):
    pass


def _headers(api_key):
    # Accept matters as much as Authorization here: Smartlane is a Laravel
    # app, and without an explicit JSON Accept its auth middleware answers a
    # bad/expired key with a 302 to the HTML login page instead of a 401.
    # requests follows redirects by default, so that used to surface as a
    # nonsense status from whatever page the chain landed on rather than
    # "your API key was rejected". With this header the same call returns a
    # clean 401 {"message": "Unauthenticated."}.
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _request(method, path, api_key, *, context="", expect="json", **kwargs):
    """Single funnel for every Smartlane call - one place that logs, and one
    place that decides what counts as a failure.

    allow_redirects=False is deliberate: a 3xx off /api/ only ever means the
    auth middleware bounced us to the login page, and following it turns a
    clear credentials problem into a confusing error from an unrelated URL
    (or, worse, an HTML 200 that reads as success).
    """
    url = f"{BASE_URL}{path}"
    label = f"{method} {path}" + (f" [{context}]" if context else "")
    started = time.monotonic()

    try:
        resp = requests.request(
            method, url, headers=_headers(api_key), allow_redirects=False, timeout=30, **kwargs
        )
    except requests.RequestException as exc:
        logger.error("smartlane %s -> unreachable after %.2fs: %s",
                     label, time.monotonic() - started, exc)
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    elapsed = time.monotonic() - started
    logger.info("smartlane %s -> HTTP %s in %.2fs (%s bytes)",
                label, resp.status_code, elapsed, len(resp.content or b""))
    logger.debug("smartlane %s response body: %s", label, (resp.text or "")[:2000])

    if resp.is_redirect or resp.is_permanent_redirect:
        logger.error("smartlane %s -> HTTP %s redirect to %r - API key rejected",
                     label, resp.status_code, resp.headers.get("Location", ""))
        raise SmartlaneAPIError(
            "Smartlane rejected the API key (it redirected to its login page). "
            "Check the key on the Smartlane integration page."
        )

    if resp.status_code in (401, 403):
        logger.error("smartlane %s -> HTTP %s unauthorised: %s",
                     label, resp.status_code, (resp.text or "")[:300])
        raise SmartlaneAPIError(
            f"Smartlane rejected the API key (HTTP {resp.status_code}). "
            "Check the key on the Smartlane integration page."
        )

    if not resp.ok:
        logger.error("smartlane %s -> HTTP %s: %s", label, resp.status_code, (resp.text or "")[:500])
        raise SmartlaneAPIError(f"{context or path} failed: {resp.status_code} {resp.text[:300]}")

    if expect == "raw":
        return resp.content
    if expect == "text":
        return resp.text
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        # A 2xx that isn't JSON means we're talking to a web page, not the
        # API. Never treat that as success - for create_booking in
        # particular, doing so would park an order in Booking Pending for a
        # consignment that was never actually created.
        logger.error("smartlane %s -> HTTP %s but body was not JSON: %s",
                     label, resp.status_code, (resp.text or "")[:300])
        raise SmartlaneAPIError(
            f"Smartlane returned a non-JSON response to {context or path} "
            f"(HTTP {resp.status_code}) - the API key or endpoint is probably wrong."
        )


def _require_key(api_key):
    if not api_key:
        raise SmartlaneAPIError("Add your Smartlane API key on the Smartlane integration page first.")


def _dummy_email(order):
    # Smartlane's consignment schema carries a consignee_email field -
    # orders placed without one (common for COD checkouts) get a
    # synthesized placeholder rather than sending an empty string, same
    # convention as the Smartlane CSV export template.
    slug = "".join(order.customer_name.lower().split()) or "customer"
    return f"{slug}@gmail.com"


def _build_consignment(order):
    items = list(order.items.all())
    total_weight_g = sum((item.weight_grams or 0) * item.quantity for item in items)
    weight_kg = round(total_weight_g / 1000, 2) if total_weight_g else 0.5

    return {
        "store_order_id": order.order_number,
        "consignee_name": order.customer_name,
        "consignee_email": order.customer_email or _dummy_email(order),
        "consignee_phone": order.customer_phone,
        "consignee_address": " ".join(filter(None, [order.address_line1, order.address_line2])),
        "consignee_city": order.city,
        "description": "Handle with care. Call Before Delivery",
        "payment_method": "cod" if order.payment_gateway == "cod" else "prepaid",
        "amount": str(order.amount_receivable),
        "product_count": str(sum(item.quantity for item in items) or 1),
        "weight": str(weight_kg),
        "products": [
            {"sku": item.barcode or item.product_name[:50], "name": item.product_name, "qty": str(item.quantity)}
            for item in items
        ] or [{"sku": order.order_number, "name": "Item", "qty": "1"}],
    }


def create_booking(order, api_key, warehouse_code):
    """Submits this order to Smartlane's booking api (POST /create).

    Smartlane validates and queues the consignment but does NOT return a
    consignment/tracking number in this response - that arrives later,
    either via the registered webhook or by polling /track (see
    track_consignments below). Callers must not treat this call's return
    value as a tracking number; it's just confirmation the booking was
    accepted, and the order should sit in an interim "booking submitted"
    state until a real consignment number shows up.
    """
    _require_key(api_key)
    if not warehouse_code:
        raise SmartlaneAPIError(
            "Set a Smartlane warehouse code on the Smartlane integration page first "
            "(Store > Warehouse on the Smartlane portal, or fetch_warehouse_list())."
        )

    body = {
        "store_warehouse_code": warehouse_code,
        "consignments": [_build_consignment(order)],
    }
    logger.info("smartlane booking order=%s warehouse=%s city=%r amount=%s",
                order.order_number, warehouse_code, order.city, order.amount_receivable)
    logger.debug("smartlane booking payload for %s: %s", order.order_number, body)

    data = _request("POST", "/create", api_key, context=f"Booking {order.order_number}", json=body)
    logger.info("smartlane booking accepted order=%s response=%s", order.order_number, data)
    return data


def track_consignments(api_key, store_order_ids):
    """Bulk status lookup for orders booked through Smartlane.

    GET /consignment/track?store_order_id[]=...&store_order_id[]=...

    This is a pull rather than a push, which is what makes automatic
    delivery/return updates (and picking up the consignment number after
    booking) possible without a publicly reachable webhook URL.
    """
    _require_key(api_key)
    if not store_order_ids:
        return []

    params = [("store_order_id[]", str(oid)) for oid in store_order_ids]
    payload = _request(
        "GET", "/track", api_key,
        context=f"Tracking {len(store_order_ids)} order(s)", params=params,
    )

    # Their responses wrap the rows under a data/consignments key
    # depending on endpoint; accept either, and a bare list too.
    if isinstance(payload, dict):
        for key in ("data", "consignments", "result"):
            if isinstance(payload.get(key), list):
                logger.info("smartlane track returned %s row(s) under %r", len(payload[key]), key)
                return payload[key]
        logger.warning("smartlane track returned a dict with no recognised rows key: %s",
                       list(payload.keys()))
        return []
    if isinstance(payload, list):
        logger.info("smartlane track returned %s row(s)", len(payload))
        return payload
    logger.warning("smartlane track returned unexpected type %s", type(payload).__name__)
    return []


def cancel_consignment(api_key, store_order_id):
    """Cancels a booked consignment - only valid before the courier has
    collected it from the warehouse."""
    _require_key(api_key)
    return _request(
        "POST", "/cancel", api_key,
        context=f"Cancel {store_order_id}",
        json={"store_order_id": str(store_order_id)},
    )


def fetch_airway_bill(api_key, store_order_ids, *, no_of_prints=1):
    """Returns raw HTML (not JSON) for the airway bill of one or more
    booked consignments - meant to be served straight through to the
    browser, not parsed."""
    _require_key(api_key)
    if not store_order_ids:
        raise SmartlaneAPIError("No orders to print an airway bill for.")

    params = [("store_order_id[]", str(oid)) for oid in store_order_ids]
    params.append(("no_of_prints", str(no_of_prints)))
    return _request(
        "GET", "/airway/bill", api_key,
        context=f"Airway bill for {len(store_order_ids)} order(s)",
        expect="text", params=params,
    )


def fetch_load_sheet(api_key, *, courier, store_order_ids=None, start_date=None, end_date=None):
    """Returns raw PDF bytes (not JSON) for the load sheet of parcels
    ready for a given courier - Smartlane generates it for one courier at
    a time. Either store_order_ids or a start/end date range is required;
    if store_order_ids is given the date range is ignored by Smartlane."""
    _require_key(api_key)
    if not courier:
        raise SmartlaneAPIError("courier is required for the load sheet.")
    if not store_order_ids and not (start_date and end_date):
        raise SmartlaneAPIError("Provide store_order_ids or both start_date and end_date.")

    params = [("courier", courier)]
    if store_order_ids:
        params += [("store_order_ids[]", str(oid)) for oid in store_order_ids]
    else:
        params += [("start_date", start_date), ("end_date", end_date)]

    return _request(
        "GET", "/load_sheet", api_key,
        context=f"Load sheet ({courier})", expect="raw", params=params,
    )


def fetch_city_list(api_key):
    _require_key(api_key)
    return _request("GET", "/city/list", api_key, context="City list")


def fetch_warehouse_list(api_key):
    _require_key(api_key)
    return _request("GET", "/warehouse/list", api_key, context="Warehouse list")


def get_shipper_advice(api_key):
    _require_key(api_key)
    return _request("GET", "/shipperadvice/get", api_key, context="Shipper advice")


def update_shipper_advice(api_key, *, consignment_number, store_order_id, courier, reason, remarks, action):
    """action must be "Return" or "Reattempt" per Smartlane's doc."""
    _require_key(api_key)
    if action not in ("Return", "Reattempt"):
        raise SmartlaneAPIError('action must be "Return" or "Reattempt"')

    body = {
        "consignment_number": consignment_number,
        "store_order_id": str(store_order_id),
        "courier": courier,
        "reason": reason,
        "remarks": remarks,
        "action": action,
    }
    return _request(
        "POST", "/shipperadvice/update", api_key,
        context=f"Shipper advice {action} for {store_order_id}", json=body,
    )
