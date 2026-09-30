"""Thin HTTP client for BarqRaftar's own courier API (base
https://barqraftar.pk/api/v1 - docs at https://barqraftar.pk/api-documentation).
Modelled closely on integrations/smartlane_client.py's _request funnel, but
kept entirely separate: BarqRaftar auth is a `key`/`secret` header pair (not
a bearer token), and this module must never import from smartlane_client.py
or vice versa, so neither integration can ever affect the other's
behaviour.

Response shapes below were confirmed against real responses from a live
account (2026-09-29) plus BarqRaftar's own API documentation page:
- Errors (bad key/secret, missing params, ...) come back as HTTP 400 with
  {"error": true, "message": ..., "error_code"?: "BR001"} - a bad key/secret
  has NO error_code at all, just the message. See _request.
- GET /order wraps the order: {"status": "success", "order": {...}}, and an
  unknown tracking number is HTTP 200 {"status": "false", "order": {}} - see
  get_order, which unwraps both to the bare order dict (or {}).
- Order "status" is a numeric string ("1") in GET /orders, but a slug
  ("pending") in GET /order and get_multiple_orders - normalised by
  barqraftar/services.py's _coerce_status_code.
- bulk_store / bulk_change_status report per-order outcomes as HTTP 200
  {"orders_result": [{"success": false, "message": ...}]} - a failed
  status change is NOT an HTTP error. See first_result_error.
"""

import logging
import time

import requests
from django.conf import settings

from .exceptions import BarqRaftarAPIError

logger = logging.getLogger(__name__)

BASE_URL = settings.BARQRAFTAR_API_BASE_URL

# BarqRaftar's own documented error codes. BR000 means the key/secret pair
# itself was rejected - though in practice a bad key/secret comes back with
# no error_code at all, just this message (confirmed live), so both are
# checked in _request.
_CREDENTIALS_ERROR_CODE = "BR000"
_CREDENTIALS_ERROR_HINT = "api key"


def _headers(api_key, api_secret):
    return {
        "key": api_key,
        "secret": api_secret,
        "Accept": "application/json",
    }


def _request(method, path, api_key, api_secret, *, context="", expect="json",
             tolerate=(), timeout=30, **kwargs):
    """Single funnel for every BarqRaftar call - same shape and reasoning as
    smartlane_client._request (one place that logs, one place that decides
    what counts as a failure), independently implemented so this file has
    no runtime dependency on the Smartlane integration at all."""
    url = f"{BASE_URL}{path}"
    label = f"{method} {path}" + (f" [{context}]" if context else "")
    started = time.monotonic()

    try:
        resp = requests.request(
            method,
            url,
            headers=_headers(api_key, api_secret),
            allow_redirects=False,
            timeout=timeout,
            **kwargs,
        )
    except requests.RequestException as exc:
        logger.error("barqraftar %s -> unreachable after %.2fs: %s",
                     label, time.monotonic() - started, exc)
        raise BarqRaftarAPIError(f"Could not reach BarqRaftar: {exc}") from exc

    elapsed = time.monotonic() - started
    logger.info("barqraftar %s -> HTTP %s in %.2fs (%s bytes)",
                label, resp.status_code, elapsed, len(resp.content or b""))
    logger.debug("barqraftar %s response body: %s", label, (resp.text or "")[:2000])

    if resp.is_redirect or resp.is_permanent_redirect:
        logger.error("barqraftar %s -> HTTP %s redirect to %r - key/secret likely rejected",
                     label, resp.status_code, resp.headers.get("Location", ""))
        raise BarqRaftarAPIError(
            "BarqRaftar rejected the request (it redirected instead of answering). "
            "Check the API key/secret on the BarqRaftar integration page."
        )

    if resp.status_code in (401, 403):
        logger.error("barqraftar %s -> HTTP %s unauthorised: %s",
                     label, resp.status_code, (resp.text or "")[:300])
        raise BarqRaftarAPIError(
            f"BarqRaftar rejected the API key/secret (HTTP {resp.status_code})."
        )

    # BarqRaftar's own error envelope: {"error": true, "message": ...,
    # "error_code"?: ...} - HTTP 400 in practice (confirmed live for a bad
    # key/secret and for BR001), but checked regardless of status so a 200
    # carrying it can never be mistaken for success. {"success": false} is
    # the same idea from the endpoints that use a `success` flag instead
    # (company_addresses/store, company_payments). Checked before the
    # generic not-ok handling below so the user sees BarqRaftar's own
    # message, not a raw "400 {...}".
    body = None
    if resp.content and "json" in (resp.headers.get("Content-Type") or "").lower():
        try:
            body = resp.json()
        except ValueError:
            body = None
    if isinstance(body, dict) and (body.get("error") is True or body.get("success") is False):
        message = str(body.get("message") or "BarqRaftar reported an error.")
        code = body.get("error_code") or body.get("code") or ""
        logger.error("barqraftar %s -> HTTP %s error %s: %s", label, resp.status_code, code or "-", message)
        if code == _CREDENTIALS_ERROR_CODE or _CREDENTIALS_ERROR_HINT in message.lower():
            raise BarqRaftarAPIError(
                f"BarqRaftar rejected the API key/secret: {message} "
                "Check them on the BarqRaftar integration page."
            )
        raise BarqRaftarAPIError(f"BarqRaftar: {message}" + (f" ({code})" if code else ""))

    if not resp.ok and resp.status_code not in tolerate:
        logger.error("barqraftar %s -> HTTP %s: %s", label, resp.status_code, (resp.text or "")[:500])
        raise BarqRaftarAPIError(f"{context or path} failed: {resp.status_code} {resp.text[:300]}")
    if not resp.ok:
        logger.warning("barqraftar %s -> HTTP %s (tolerated): %s",
                       label, resp.status_code, (resp.text or "")[:300])

    if expect == "raw":
        content_type = resp.headers.get("Content-Type", "")
        if "pdf" not in content_type.lower():
            logger.error("barqraftar %s -> HTTP %s but Content-Type was %r, not pdf: %s",
                         label, resp.status_code, content_type, (resp.text or "")[:500])
            raise BarqRaftarAPIError(
                f"BarqRaftar didn't return a PDF for {context or path} "
                f"(got {content_type or 'no content-type'}): {(resp.text or '')[:300]}"
            )
        return resp.content
    if expect == "text":
        return resp.text
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        logger.error("barqraftar %s -> HTTP %s but body was not JSON: %s",
                     label, resp.status_code, (resp.text or "")[:300])
        raise BarqRaftarAPIError(
            f"BarqRaftar returned a non-JSON response to {context or path} "
            f"(HTTP {resp.status_code}) - the API key/secret or endpoint is probably wrong."
        )


def _require_credentials(api_key, api_secret):
    if not api_key or not api_secret:
        raise BarqRaftarAPIError("Add your BarqRaftar API key and secret on the BarqRaftar integration page first.")


# Where each endpoint actually puts its rows (confirmed live / per their
# docs): /cities -> "cities", /orders and get_multiple_orders -> "orders",
# get_pickup_address -> "addresses" (live) or data.pickup_addresses (docs),
# company_payments/index -> company_payments.data (a Laravel paginator),
# bulk_store / bulk_change_status -> "orders_result".
_ROW_KEYS = ("cities", "orders", "addresses", "pickup_addresses", "company_payments",
             "orders_result", "data", "result")


def _rows(payload):
    """Pulls the list of rows out of any BarqRaftar response envelope."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in _ROW_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                if isinstance(value.get("data"), list):
                    return value["data"]
                for inner_key in _ROW_KEYS:
                    if isinstance(value.get(inner_key), list):
                        return value[inner_key]
    return []


def first_result_error(payload):
    """bulk_store / bulk_change_status answer HTTP 200 even when an order
    failed - the failure is only in orders_result[i].success. Returns the
    first failed row's message, or "" if every row succeeded."""
    if not isinstance(payload, dict):
        return ""
    for row in payload.get("orders_result") or []:
        if isinstance(row, dict) and row.get("success") is False:
            return str(row.get("message") or "BarqRaftar rejected the request.")
    return ""


# ---------------------------------------------------------------- Cities --

def fetch_cities(api_key, api_secret):
    _require_credentials(api_key, api_secret)
    payload = _request("GET", "/cities", api_key, api_secret, context="Get cities")
    return _rows(payload)


# ---------------------------------------------------------------- Orders --

def bulk_store(api_key, api_secret, orders, *, create_pickup_request=False,
                pickup_address_id=None, pickup_address=None):
    """POST /orders/bulk_store. `orders` is a list of BarqRaftar order dicts
    already built by barqraftar/services.py's payload builder. Returns the
    raw response dict (confirmed live):
    {"failed_orders_count", "success_orders_count", "pickup_request_created",
     "orders_result": [
      {"success": true, "reference_id", "tracking_number", "message": "Order added to BarqRaftar"} |
      {"success": false, "reference_id", "message": "invalid to_city_id" | ...}]}.
    One bad order doesn't fail the others - each has its own row.

    create_pickup_request is only sent at all when a pickup IS wanted, as
    "true". Sending "false" crashed BarqRaftar with HTTP 500 "Server
    Error" on every attempt (confirmed live, 2026-09-29) - their PHP side
    evidently treats the non-empty string "false" as true and then fails
    for lack of a pickup address - while the same body with the key left
    out books normally."""
    _require_credentials(api_key, api_secret)
    if not orders:
        return {"orders_result": []}
    body = {
        "total_orders": len(orders),
        "orders": orders,
    }
    if create_pickup_request:
        body["create_pickup_request"] = "true"
        if pickup_address_id:
            body["pickup_address_id"] = (
                int(pickup_address_id) if str(pickup_address_id).isdigit() else pickup_address_id
            )
        elif pickup_address:
            body["pickup_address"] = pickup_address
    return _request(
        "POST", "/orders/bulk_store", api_key, api_secret,
        context=f"Booking {len(orders)} order(s)", json=body, timeout=60,
    )


def get_order(api_key, api_secret, *, tracking_number=None, reference_id=None):
    """GET /order. Returns the bare order dict - BarqRaftar wraps it as
    {"status": "success", "order": {...}} - or {} when BarqRaftar doesn't
    know it (HTTP 200 {"status": "false", "order": {}}, confirmed live).
    Unwrapping here matters: the wrapper's own "status": "success" would
    otherwise be read as the order's status."""
    _require_credentials(api_key, api_secret)
    if tracking_number:
        params = {"tracking_number": tracking_number}
        context = f"Track {tracking_number}"
    elif reference_id:
        params = {"reference_id": reference_id}
        context = f"Track (reference {reference_id})"
    else:
        raise BarqRaftarAPIError("get_order needs either tracking_number or reference_id.")
    payload = _request(
        "GET", "/order", api_key, api_secret, context=context, params=params, tolerate=(404,),
    )
    if not isinstance(payload, dict) or str(payload.get("status")).lower() == "false":
        return {}
    order = payload.get("order")
    return order if isinstance(order, dict) else {}


def get_multiple_orders(api_key, api_secret, tracking_numbers, *, page=1, per_page=100):
    _require_credentials(api_key, api_secret)
    if not tracking_numbers:
        return []
    payload = _request(
        "POST", "/orders/get_multiple_orders", api_key, api_secret,
        context=f"Tracking {len(tracking_numbers)} order(s)",
        json={"tracking_numbers": list(tracking_numbers), "page": page, "per_page": per_page},
    )
    return _rows(payload)


def list_orders(api_key, api_secret, **filters):
    """GET /orders with any of date_from/date_to/page/limit/status/
    tracking_number/reference_id/customer_name/paid_at_from/paid_at_to."""
    _require_credentials(api_key, api_secret)
    params = {k: v for k, v in filters.items() if v not in (None, "")}
    return _request("GET", "/orders", api_key, api_secret, context="List orders", params=params)


def change_status(api_key, api_secret, items):
    """POST /orders/bulk_change_status. `items` is a list of
    {"tracking_number": ..., "status": "awaiting_pickup"|"cancelled"|...}."""
    _require_credentials(api_key, api_secret)
    if not items:
        return {}
    body = {"total_orders": len(items), "orders": items}
    return _request(
        "POST", "/orders/bulk_change_status", api_key, api_secret,
        context=f"Changing status of {len(items)} order(s)", json=body,
    )


# ---------------------------------------------------------------- Labels --

def print_labels(api_key, api_secret, tracking_numbers, *, response_type="pdf", label_format="a4"):
    """POST /orders/print_orders. Max 20 tracking numbers per BarqRaftar's
    own limit (enforced by the caller - see barqraftar/views.py). With
    response_type="pdf" BarqRaftar answers application/pdf directly
    (confirmed live) and the raw bytes are returned; with "link" it's
    {"success": true, "link": ..., "label_format": ...}."""
    _require_credentials(api_key, api_secret)
    if not tracking_numbers:
        raise BarqRaftarAPIError("No orders to print a label for.")
    body = {
        "tracking_numbers": list(tracking_numbers),
        "response_type": response_type,
        "label_format": label_format,
    }
    expect = "raw" if response_type == "pdf" else "json"
    return _request(
        "POST", "/orders/print_orders", api_key, api_secret,
        context=f"Printing {len(tracking_numbers)} label(s)", json=body, expect=expect,
    )


# --------------------------------------------------------- Shipper advice --

def shipper_advice_options(api_key, api_secret):
    _require_credentials(api_key, api_secret)
    return _request("GET", "/orders/shipper_advices", api_key, api_secret, context="Shipper advice options")


def add_shipper_advice(api_key, api_secret, *, tracking_number=None, order_id=None,
                        shipper_advice, re_attempt_reason=None, re_attempt_reason_text=None,
                        new_address=None):
    _require_credentials(api_key, api_secret)
    body = {"shipper_advice": shipper_advice}
    if tracking_number:
        body["tracking_number"] = tracking_number
    elif order_id:
        body["order_id"] = order_id
    else:
        raise BarqRaftarAPIError("add_shipper_advice needs either tracking_number or order_id.")
    if re_attempt_reason:
        body["re_attempt_reason"] = re_attempt_reason
    if re_attempt_reason_text:
        body["re_attempt_reason_text"] = re_attempt_reason_text
    if new_address:
        body["new_address"] = new_address
    return _request(
        "POST", "/orders/add_shipper_advice", api_key, api_secret,
        context="Add shipper advice", json=body,
    )


# ----------------------------------------------------------------- Pickup --

def list_pickup_addresses(api_key, api_secret):
    _require_credentials(api_key, api_secret)
    payload = _request(
        "GET", "/company_addresses/get_pickup_address", api_key, api_secret,
        context="Get pickup addresses",
    )
    return _rows(payload)


def save_pickup_address(api_key, api_secret, *, pickup_address_id=None, name, address, city_id,
                         person_of_contact, phone_number, latitude=None, longitude=None):
    """POST /company_addresses/store - form-data, not JSON. Answers
    {"status": true, "message": "Address added successfully!",
    "pickup_address_id": <new id>} (confirmed live).

    NOTE: despite the docs calling pickup_address_id the way to UPDATE an
    existing address, sending it created a brand-new address instead
    (confirmed live, 2026-09-29) - so the UI only ever offers "add", never
    "edit"."""
    _require_credentials(api_key, api_secret)
    data = {
        "name": name,
        "address": address,
        "city_id": str(city_id),
        "person_of_contact": person_of_contact,
        "phone_number": phone_number,
    }
    if pickup_address_id:
        data["pickup_address_id"] = pickup_address_id
    if latitude is not None:
        data["latitude"] = str(latitude)
    if longitude is not None:
        data["longitude"] = str(longitude)
    return _request(
        "POST", "/company_addresses/store", api_key, api_secret,
        context="Save pickup address", data=data,
    )


# --------------------------------------------------------------- Payments --

def list_payments(api_key, api_secret, *, date_from=None, date_to=None, page=1, limit=10):
    _require_credentials(api_key, api_secret)
    params = {"page": page, "limit": limit}
    if date_from:
        params["date_from"] = date_from
    if date_to:
        params["date_to"] = date_to
    payload = _request(
        "GET", "/company_payments/index", api_key, api_secret, context="List payments", params=params,
    )
    # {"success": true, "company_payments": <Laravel paginator>} - rows are
    # company_payments.data (confirmed live; empty for this account so far,
    # row fields per BarqRaftar's docs: id, invoice_number, orders_count,
    # net_collected_amount, net_payable, ...).
    pager = payload.get("company_payments") if isinstance(payload, dict) else None
    pager = pager if isinstance(pager, dict) else {}
    return {
        "payments": _rows(payload),
        "total": pager.get("total") or 0,
        "current_page": pager.get("current_page") or 1,
        "last_page": pager.get("last_page") or 1,
    }


def payment_detail(api_key, api_secret, payment_id):
    _require_credentials(api_key, api_secret)
    return _request(
        "GET", f"/company_payments/detail/{payment_id}", api_key, api_secret,
        context=f"Payment {payment_id} detail",
    )
