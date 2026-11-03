"""Thin HTTP client for Leopards Courier's Merchant API v2 (production
https://merchantapi.leopardscourier.com/api, staging
https://merchantapistaging.leopardscourier.com/api - see
settings.LEOPARDS_API_BASE_URL). Same single-funnel shape as
integrations/postex/client.py, independently implemented: this module never
imports from the Smartlane, BarqRaftar or PostEx clients, and they never
import from it.

Auth is the merchant account's api_key + api_password, sent in the JSON body
of a POST (or the query string of a GET-only endpoint) on every call - there
is no token or header. Every endpoint is `<base>/<name>/format/json/` (the
PDF load sheet is the one exception, `<base>/downloadLoadSheet/`).

Responses are JSON {"status": 1 | 0, "error": 0 | "text" | {field: text}, ...}:
success is decided by `status` alone, never the HTTP code (Leopards answers
failures with HTTP 200 too). `status` is an int in some answers and a string
in others ("1"), so it is compared as text. `error` is a plain string for
most failures, but a per-field dict for booking validation errors - see
_error_text.

Written from Leopards' API Documentation v2.0 PDF and the Postman collection
the merchant tested every request with; nothing here was run against the
live API by the author.
"""

import json
import logging
import time

import requests
from django.conf import settings

from .exceptions import LeopardsAPIError

logger = logging.getLogger(__name__)

BASE_URL = settings.LEOPARDS_API_BASE_URL.rstrip("/")

# Leopards' documented limit isn't stated; 50 is the figure its payment /
# charges / proof-of-delivery endpoints quote for one call, so every
# comma-separated CN call is chunked to it by the callers.
MAX_CNS_PER_CALL = 50

# Words that mean "the credentials were refused" in Leopards' error text.
_AUTH_HINTS = ("api key", "api_key", "api password", "api_password", "authenticat", "credential", "unauthor")


def _flatten(value):
    """Any `error` shape -> readable text: "Weight is required", or for the
    per-field dict {"booked_packet_weight": "Packet Weight is required"} ->
    "booked_packet_weight: Packet Weight is required"; the batch endpoints'
    nested {"bookPacket - 0": {...}} flatten the same way."""
    if isinstance(value, dict):
        parts = []
        for key, inner in value.items():
            text = _flatten(inner)
            if text:
                parts.append(text if str(key).startswith("bookPacket") else f"{key}: {text}")
        return "; ".join(parts)
    if isinstance(value, (list, tuple)):
        return "; ".join(t for t in (_flatten(v) for v in value) if t)
    if value is None:
        return ""
    return str(value).strip()


def _error_text(body):
    text = _flatten(body.get("error")) if isinstance(body, dict) else ""
    if text in ("0", "null", "None"):
        text = ""
    return text


def _is_ok(body):
    return isinstance(body, dict) and str(body.get("status")).strip() == "1"


def _require_credentials(connection):
    if not (connection.api_key and connection.api_password):
        raise LeopardsAPIError(
            "Add your Leopards API key and password on the Leopards integration page first.", kind="auth"
        )


def _request(method, path, connection, *, context="", body=None, params=None, expect="json", timeout=60):
    """Single funnel for every Leopards call. Returns the parsed body (dict)
    for expect="json", raw bytes for expect="pdf". Raises LeopardsAPIError
    for anything that isn't a clean success."""
    _require_credentials(connection)
    url = f"{BASE_URL}{path}"
    label = f"{method} {path}" + (f" [{context}]" if context else "")
    credentials = {"api_key": connection.api_key, "api_password": connection.api_password}
    started = time.monotonic()

    kwargs = {}
    if method == "GET":
        kwargs["params"] = {**credentials, **(params or {})}
    else:
        kwargs["json"] = {**credentials, **(body or {})}

    try:
        resp = requests.request(
            method, url, headers={"Accept": "application/json"}, allow_redirects=False, timeout=timeout, **kwargs,
        )
    except requests.Timeout as exc:
        logger.error("leopards %s -> timed out after %.2fs", label, time.monotonic() - started)
        raise LeopardsAPIError(
            f"Leopards didn't answer in time ({context or path}) - try again shortly.", kind="network"
        ) from exc
    except requests.RequestException as exc:
        logger.error("leopards %s -> unreachable after %.2fs: %s", label, time.monotonic() - started, exc)
        raise LeopardsAPIError(f"Could not reach Leopards: {exc}", kind="network") from exc

    logger.info("leopards %s -> HTTP %s in %.2fs (%s bytes)",
                label, resp.status_code, time.monotonic() - started, len(resp.content or b""))

    if expect == "pdf" and resp.ok and (
        "pdf" in (resp.headers.get("Content-Type") or "").lower() or (resp.content or b"").startswith(b"%PDF")
    ):
        return resp.content

    parsed = None
    if resp.content:
        try:
            parsed = json.loads(resp.text)
        except ValueError:
            parsed = None
    logger.debug("leopards %s response body: %s", label, (resp.text or "")[:2000] if expect != "pdf" else "<pdf?>")

    if resp.status_code in (401, 403):
        raise LeopardsAPIError(
            "Leopards rejected the API key / password. Check them on the Leopards integration page.",
            kind="auth",
        )

    if isinstance(parsed, dict):
        if not _is_ok(parsed):
            message = _error_text(parsed) or f"error (HTTP {resp.status_code})"
            kind = "auth" if any(h in message.lower() for h in _AUTH_HINTS) else "api"
            logger.error("leopards %s -> refused: %s", label, message[:500])
            raise LeopardsAPIError(f"Leopards: {message}", kind=kind)
        if expect == "pdf":
            raise LeopardsAPIError(f"Leopards didn't return a PDF for {context or path}.")
        return parsed

    if not resp.ok:
        logger.error("leopards %s -> HTTP %s: %s", label, resp.status_code, (resp.text or "")[:500])
        raise LeopardsAPIError(f"Leopards {context or path} failed: HTTP {resp.status_code}.")
    if expect == "pdf":
        raise LeopardsAPIError(f"Leopards didn't return a PDF for {context or path}.")
    logger.error("leopards %s -> HTTP %s but body was not JSON: %s", label, resp.status_code, (resp.text or "")[:300])
    raise LeopardsAPIError(f"Leopards returned a non-JSON response to {context or path}.")


def _list(body, key):
    rows = body.get(key) if isinstance(body, dict) else None
    return rows if isinstance(rows, list) else []


# ------------------------------------------------------------ Reference --

def get_all_cities(connection):
    """[{"id": 789, "name": "Lahore", "shipment_type": [...],
    "allow_as_origin": bool, "allow_as_destination": bool}] - every city
    Leopards serves. Also the cheapest authenticated call, so it doubles as
    the credential check on connect."""
    body = _request("POST", "/getAllCities/format/json/", connection, context="Cities", timeout=90)
    return _list(body, "city_list")


def get_all_banks(connection):
    """[{"bank_id": 1, "bank_name_eng": "..."}] - the ids createShipper takes."""
    body = _request("POST", "/getBankList/format/json/", connection, context="Banks")
    return _list(body, "bank_list")


def create_shipper(connection, *, name, email, phone, address, city_id, bank_id, cnic="", return_address=""):
    """POST createShipper - adds a shipper under this account (or returns the
    existing one: "Shipper already exists."). Returns the shipper row
    {"shipment_id", "shipment_name", ...}; shipment_id is what bookPacket's
    shipment_id takes.

    Leopards documents `data` as a list but really answers with ONE object
    ({"status": 1, "message": "Shipper added successfully.", "data":
    {"shipment_id": 2851241, "shipment_name": ..., "username": ...,
    "user_password": ...}}), so both shapes are read. The shipper's own
    portal login (username / user_password) comes back too - it is dropped
    here and never stored or logged."""
    body = _request(
        "POST", "/createShipper/format/json/", connection, context=f"Create shipper {name}",
        body={
            "shipment_name": name,
            "shipment_email": email or "",
            "shipment_phone": phone,
            "shipment_address": address,
            "bank_id": int(bank_id),
            "bank_account_no": "",
            "bank_account_title": "",
            "bank_branch": "",
            "bank_account_iban_no": "",
            "city_id": str(city_id),
            "cnic": cnic or "",
            "return_address": return_address or "",
        },
    )
    data = body.get("data")
    if isinstance(data, list):
        data = data[0] if data and isinstance(data[0], dict) else {}
    elif not isinstance(data, dict):
        data = {}
    row = {k: v for k, v in data.items() if k not in ("username", "user_password")}
    return {**row, "message": str(body.get("message") or "")}


# -------------------------------------------------------------- Booking --

def book_packet(connection, payload):
    """POST bookPacket with a payload built by leopards/services.py. Returns
    {"track_number", "slip_link", ...}. Leopards books one packet per call
    here (batchBookPacketv2 exists, but one call per order keeps each
    order's error apart)."""
    body = _request(
        "POST", "/bookPacket/format/json/", connection,
        context=f"Book {payload.get('booked_packet_order_id', '')}", body=payload, timeout=60,
    )
    return body


def cancel_packets(connection, cn_numbers):
    """POST cancelBookedPackets - comma-separated CNs. Leopards answers
    status 0 with {cn: reason} for any it refuses."""
    return _request(
        "POST", "/cancelBookedPackets/format/json/", connection,
        context=f"Cancel {len(cn_numbers)} packet(s)", body={"cn_numbers": ",".join(cn_numbers)},
    )


def track_packets(connection, cn_numbers):
    """POST trackBookedPacket (comma-separated CNs). Returns {cn: row} for
    every packet Leopards answers about; a row carries booked_packet_status,
    activity_date, status_remarks and "Tracking Detail" (the history).
    Raises LeopardsAPIError when Leopards refuses the whole request - e.g.
    one unknown CN in the list (services._track_chunk splits and retries)."""
    if not cn_numbers:
        return {}
    body = _request(
        "POST", "/trackBookedPacket/format/json/", connection,
        context=f"Tracking {len(cn_numbers)} packet(s)", body={"track_numbers": ",".join(cn_numbers)}, timeout=90,
    )
    result = {}
    for row in _list(body, "packet_list"):
        if isinstance(row, dict) and row.get("track_number"):
            result[str(row["track_number"]).strip()] = row
    return result


def shipment_details_by_order_ids(connection, order_ids):
    """POST getShipmentDetailsByOrderID - Leopards' packets by OUR order id
    (booked_packet_order_id). Not used by the poller yet; here for adopting
    portal bookings later."""
    body = _request(
        "POST", "/getShipmentDetailsByOrderID/format/json/", connection,
        context=f"Shipment details for {len(order_ids)} order(s)", body={"shipment_order_id": list(order_ids)},
    )
    return _list(body, "data")


# ------------------------------------------------------------ Documents --

def generate_load_sheet(connection, cn_numbers, *, courier_name, courier_code):
    """POST generateLoadSheet -> the new load_sheet_id. This is the hand-over
    step on Leopards' side."""
    if not cn_numbers:
        raise LeopardsAPIError("No orders to put on a load sheet.")
    body = _request(
        "POST", "/generateLoadSheet/format/json/", connection,
        context=f"Load sheet for {len(cn_numbers)} order(s)",
        body={"cn_numbers": list(cn_numbers), "courier_name": courier_name, "courier_code": str(courier_code)},
        timeout=120,
    )
    sheet_id = str(body.get("load_sheet_id") or "").strip()
    if not sheet_id:
        raise LeopardsAPIError("Leopards made the load sheet but returned no load_sheet_id.")
    return sheet_id


def download_load_sheet_pdf(connection, load_sheet_id):
    """POST downloadLoadSheet (response_type PDF) -> the sheet's PDF bytes."""
    return _request(
        "POST", "/downloadLoadSheet/", connection, expect="pdf", context=f"Load sheet {load_sheet_id}",
        body={"load_sheet_id": str(load_sheet_id), "response_type": "PDF"}, timeout=120,
    )


def fetch_slip(url):
    """GET a booking's slip_link (the airway bill). It is a plain public URL
    - no credentials. Returns (bytes, content_type)."""
    try:
        resp = requests.get(url, timeout=60, allow_redirects=True)
    except requests.RequestException as exc:
        raise LeopardsAPIError(f"Could not fetch the Leopards slip: {exc}", kind="network") from exc
    if not resp.ok:
        raise LeopardsAPIError(f"Leopards' slip link answered HTTP {resp.status_code}.")
    return resp.content, (resp.headers.get("Content-Type") or "").lower()


# ----------------------------------------------------- Billing and advice --

def payment_details(connection, cn_numbers):
    """GET getPaymentDetails - [{"booked_packet_cn", "billing_method",
    "status", "invoice_cheque_no", "invoice_cheque_date", "payment_method",
    "message", "slip_link"}]."""
    body = _request(
        "GET", "/getPaymentDetails/format/json/", connection, context="Payment details",
        params={"cn_numbers": ",".join(cn_numbers)},
    )
    return _list(body, "payment_list")


def shipping_charges(connection, cn_numbers):
    """GET getShippingCharges - billed charges per CN."""
    body = _request(
        "GET", "/getShippingCharges/format/json/", connection, context="Shipping charges",
        params={"cn_numbers": ",".join(cn_numbers)},
    )
    return _list(body, "data")


def shipper_advice_list(connection, cn_number):
    """POST shipperAdviceList (the filtered form) for one CN - rows carry the
    `id` updateShipperAdvice needs."""
    body = _request(
        "POST", "/shipperAdviceList/format/json/", connection, context=f"Shipper advice {cn_number}",
        body={
            "product": "", "status": "", "origionID": "", "destinationID": "",
            "dateFrom": "", "toDate": "", "Cn_number": cn_number, "start": 0, "length": 100,
        },
    )
    return _list(body, "data")


def update_shipper_advice(connection, *, advice_id, cn_number, status, remarks):
    """POST updateShipperAdvice - status "RA" (re-attempt) or "RT" (return)."""
    return _request(
        "POST", "/updateShipperAdvice/format/json/", connection, context=f"Shipper advice {cn_number}",
        body={"data": [{
            "id": int(advice_id), "cn_number": cn_number,
            "shipper_advice_status": status, "shipper_remarks": remarks or "",
        }]},
    )
