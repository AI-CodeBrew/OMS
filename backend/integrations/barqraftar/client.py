"""Thin HTTP client for BarqRaftar's own courier API (base
https://barqraftar.pk/api/v1, per their Postman collection - see
NOTES.md/the collection itself for the full endpoint list). Modelled
closely on integrations/smartlane_client.py's _request funnel, but kept
entirely separate: BarqRaftar auth is a `key`/`secret` header pair (not a
bearer token), and this module must never import from smartlane_client.py
or vice versa, so neither integration can ever affect the other's
behaviour.

No sample responses were available when this was written (the Postman
collection's saved responses are empty), so every reader below is
defensive: it looks for rows under a few plausible keys and never assumes
a field is present.
"""

import logging
import time

import requests
from django.conf import settings

from .exceptions import BarqRaftarAPIError

logger = logging.getLogger(__name__)

BASE_URL = settings.BARQRAFTAR_API_BASE_URL

# BarqRaftar's own documented error codes (see the Postman collection's
# description). BR000 means the key/secret pair itself was rejected.
_CREDENTIALS_ERROR_CODE = "BR000"


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

    # BR000 (bad key/secret) can also come back as a 200 with an error code
    # in the body, per BarqRaftar's own documented error codes - checked
    # before the generic not-ok handling below so it gets a clearer message.
    body_for_code_check = None
    if resp.content and "json" in (resp.headers.get("Content-Type") or "").lower():
        try:
            body_for_code_check = resp.json()
        except ValueError:
            body_for_code_check = None
    if isinstance(body_for_code_check, dict) and (
        body_for_code_check.get("code") == _CREDENTIALS_ERROR_CODE
        or body_for_code_check.get("error_code") == _CREDENTIALS_ERROR_CODE
    ):
        logger.error("barqraftar %s -> BR000 credentials error: %s", label, body_for_code_check)
        raise BarqRaftarAPIError(
            "BarqRaftar rejected the API key/secret (BR000). "
            "Check them on the BarqRaftar integration page."
        )

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


def _rows(payload):
    """BarqRaftar's response shape isn't documented (no sample responses in
    their own Postman collection) - accept whichever of these plausible
    containers is actually present, or a bare list, same defensive stance
    as smartlane_client._parse_track_rows."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "orders", "result", "orders_result"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict) and isinstance(value.get("data"), list):
                return value["data"]
        # Get Pickup Addresses / Get Payments style: {"data": {"data": [...]}}
        inner = payload.get("data")
        if isinstance(inner, dict):
            for key in ("data", "orders", "result"):
                if isinstance(inner.get(key), list):
                    return inner[key]
    return []


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
    raw response dict (callers read `orders_result`)."""
    _require_credentials(api_key, api_secret)
    if not orders:
        return {"orders_result": []}
    body = {
        "total_orders": len(orders),
        "orders": orders,
        "create_pickup_request": "true" if create_pickup_request else "false",
    }
    if create_pickup_request:
        if pickup_address_id:
            body["pickup_address_id"] = pickup_address_id
        elif pickup_address:
            body["pickup_address"] = pickup_address
    return _request(
        "POST", "/orders/bulk_store", api_key, api_secret,
        context=f"Booking {len(orders)} order(s)", json=body, timeout=60,
    )


def get_order(api_key, api_secret, *, tracking_number=None, reference_id=None):
    _require_credentials(api_key, api_secret)
    if tracking_number:
        params = {"tracking_number": tracking_number}
        context = f"Track {tracking_number}"
    elif reference_id:
        params = {"reference_id": reference_id}
        context = f"Track (reference {reference_id})"
    else:
        raise BarqRaftarAPIError("get_order needs either tracking_number or reference_id.")
    return _request(
        "GET", "/order", api_key, api_secret, context=context, params=params, tolerate=(404,),
    )


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
    own limit (enforced by the caller - see barqraftar/services.py). With
    response_type="pdf" the raw bytes are returned directly; with "link" the
    caller gets back a URL to download instead (their response shape isn't
    documented, so barqraftar/services.py handles both)."""
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
    """POST /company_addresses/store - form-data, not JSON, per the Postman
    collection."""
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
    return _rows(payload) if isinstance(payload, (list, dict)) and _rows(payload) else payload


def payment_detail(api_key, api_secret, payment_id):
    _require_credentials(api_key, api_secret)
    return _request(
        "GET", f"/company_payments/detail/{payment_id}", api_key, api_secret,
        context=f"Payment {payment_id} detail",
    )
