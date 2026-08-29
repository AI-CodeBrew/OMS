import requests

BASE_URL = "https://gcp.smartlane.dev/api/consignment"

# Per Smartlane's API doc v1.2, the load sheet is generated for one
# courier at a time - these are the courier codes their API recognises.
# Only Leopards is confirmed available; the rest mirror the CSV export's
# existing "coming soon" pattern until confirmed live on this account.
SUPPORTED_COURIERS = {"leopards"}


class SmartlaneAPIError(Exception):
    pass


def _headers(api_key):
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


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
    try:
        resp = requests.post(f"{BASE_URL}/create", headers=_headers(api_key), json=body, timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    if not resp.ok:
        raise SmartlaneAPIError(f"Booking failed: {resp.status_code} {resp.text[:300]}")
    return resp.json() if resp.content else {}


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
    try:
        resp = requests.get(f"{BASE_URL}/track", headers=_headers(api_key), params=params, timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    if not resp.ok:
        raise SmartlaneAPIError(f"Tracking lookup failed: {resp.status_code} {resp.text[:200]}")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise SmartlaneAPIError("Smartlane returned a non-JSON tracking response") from exc

    # Their responses wrap the rows under a data/consignments key
    # depending on endpoint; accept either, and a bare list too.
    if isinstance(payload, dict):
        for key in ("data", "consignments", "result"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return []
    return payload if isinstance(payload, list) else []


def cancel_consignment(api_key, store_order_id):
    """Cancels a booked consignment - only valid before the courier has
    collected it from the warehouse."""
    _require_key(api_key)
    try:
        resp = requests.post(
            f"{BASE_URL}/cancel",
            headers=_headers(api_key),
            json={"store_order_id": str(store_order_id)},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    if not resp.ok:
        raise SmartlaneAPIError(f"Cancel failed: {resp.status_code} {resp.text[:200]}")
    return resp.json() if resp.content else {}


def fetch_airway_bill(api_key, store_order_ids, *, no_of_prints=1):
    """Returns raw HTML (not JSON) for the airway bill of one or more
    booked consignments - meant to be served straight through to the
    browser, not parsed."""
    _require_key(api_key)
    if not store_order_ids:
        raise SmartlaneAPIError("No orders to print an airway bill for.")

    params = [("store_order_id[]", str(oid)) for oid in store_order_ids]
    params.append(("no_of_prints", str(no_of_prints)))
    try:
        resp = requests.get(f"{BASE_URL}/airway/bill", headers=_headers(api_key), params=params, timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    if not resp.ok:
        raise SmartlaneAPIError(f"Airway bill failed: {resp.status_code} {resp.text[:200]}")
    return resp.text


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

    try:
        resp = requests.get(f"{BASE_URL}/load_sheet", headers=_headers(api_key), params=params, timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc

    if not resp.ok:
        raise SmartlaneAPIError(f"Load sheet failed: {resp.status_code} {resp.text[:200]}")
    return resp.content


def fetch_city_list(api_key):
    _require_key(api_key)
    try:
        resp = requests.get(f"{BASE_URL}/city/list", headers=_headers(api_key), timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc
    if not resp.ok:
        raise SmartlaneAPIError(f"City list failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()


def fetch_warehouse_list(api_key):
    _require_key(api_key)
    try:
        resp = requests.get(f"{BASE_URL}/warehouse/list", headers=_headers(api_key), timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc
    if not resp.ok:
        raise SmartlaneAPIError(f"Warehouse list failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()


def get_shipper_advice(api_key):
    _require_key(api_key)
    try:
        resp = requests.get(f"{BASE_URL}/shipperadvice/get", headers=_headers(api_key), timeout=30)
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc
    if not resp.ok:
        raise SmartlaneAPIError(f"Shipper advice fetch failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()


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
    try:
        resp = requests.post(
            f"{BASE_URL}/shipperadvice/update", headers=_headers(api_key), json=body, timeout=30
        )
    except requests.RequestException as exc:
        raise SmartlaneAPIError(f"Could not reach Smartlane: {exc}") from exc
    if not resp.ok:
        raise SmartlaneAPIError(f"Shipper advice update failed: {resp.status_code} {resp.text[:200]}")
    return resp.json() if resp.content else {}
