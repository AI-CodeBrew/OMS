import random
import string

import requests

BASE_URL = "https://gcp.smartlane.dev/api/consignment"


class SmartlaneAPIError(Exception):
    pass


def _headers(api_key):
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def create_booking(order, api_key):
    """Creates a shipment booking on Smartlane for this order and returns
    the tracking number Smartlane assigns to it.

    STUB: Smartlane's real booking endpoint is POST {BASE_URL}/create and
    takes store_warehouse_code plus a consignments[] array (see their API
    doc v1.2). It is not wired up yet because it needs two things this
    system does not hold: the account's API token and the warehouse code
    to book against. Note also that the real API does NOT return a
    consignment number synchronously - it arrives later on the status
    webhook - so switching to it means create_booking stops returning a
    usable tracking number and poll_consignment_statuses (below) or the
    webhook becomes the source of it.

    Until then this issues a local placeholder so the rest of the
    pipeline - Ready to Print, loadsheet, airway bill, Ready to Pick -
    is exercisable end to end.
    """
    if not api_key:
        raise SmartlaneAPIError("Add your Smartlane API key on the Smartlane integration page first.")

    suffix = "".join(random.choices(string.digits, k=9))
    return f"SL{suffix}"


def track_consignments(api_key, store_order_ids):
    """Bulk status lookup for orders booked through Smartlane.

    GET /consignment/track?store_order_id[]=...&store_order_id[]=...

    This is a pull rather than a push, which is what makes automatic
    delivery/return updates possible without a publicly reachable webhook
    URL - the reason status polling works from a local machine while the
    webhook does not.
    """
    if not api_key:
        raise SmartlaneAPIError("Smartlane API key is not set.")
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
    if not api_key:
        raise SmartlaneAPIError("Smartlane API key is not set.")
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
