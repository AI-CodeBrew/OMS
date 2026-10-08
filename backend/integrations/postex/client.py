"""Thin HTTP client for PostEx's Merchant (COD) API v4.1.9 - base
https://api.postex.pk/services/integration/api/order. Same single-funnel
shape as integrations/barqraftar/client.py, independently implemented: this
module never imports from the Smartlane or BarqRaftar clients, and they
never import from it.

Auth is one `token` header per merchant account (from the PostEx merchant
portal). Every behaviour noted "confirmed live" below was checked against a
real merchant account on 2026-10-08, and several differ from the PDF guide:

- JSON responses are {"statusCode": "200", "statusMessage", "dist"} - the
  statusCode is a STRING, and a failure can come back as HTTP 200 with a
  non-"200" statusCode in the body (an unknown tracking number on
  /track-order is HTTP 200 {"statusCode": "404", "statusMessage": "RECORD
  NOT FOUND"}). So success is decided by the body, never the HTTP status
  alone - see _request.
- A bad token is HTTP 401 {"statusCode": "401", "statusMessage": "TOKEN IS
  INVALID"}.
- A missing/badly-typed query parameter is a raw Spring error: HTTP 400
  {"status": 400, "error": "Bad Request", "trace": "...Exception: Required
  ... parameter 'x' is not present ..."} - checked BEFORE the token, so
  parameter names can be wrong even with a bad token.
- /v1/get-all-order takes orderStatusId (lowercase d), startDate and endDate
  - the guide says orderStatusID/fromDate/toDate, which 400.
- /v1/track-bulk-order takes TrackingNumbers (capital T, comma-separated) -
  the guide says trackingNumber. Each row is {"trackingNumber", "message",
  "trackingResponse"}; an unknown number is just a row with message "ORDER
  NOT FOUND" and no trackingResponse.
- /v2/get-operational-city's operationalCityType is lowercase ("pickup" /
  "delivery") - "Pickup", "PICKUP" and "Delivery" all 400. It returns the
  same ~900 cities either way, so it's simply left off.
- Tracking numbers are plain digits ("26704560000656"), not "CX-...".
- Shipper advice lives under /services/ like everything else - the guide's
  /service/ (singular) is a 404.
- /v1/get-invoice (airway bill) answers application/pdf; an unknown number
  is HTTP 404 {"statusCode": "404", "statusMessage": "Order not found with
  tracking Number : ..."}.
"""

import logging
import re
import time

import requests
from django.conf import settings

from .exceptions import PostExAPIError

logger = logging.getLogger(__name__)

BASE_URL = settings.POSTEX_API_BASE_URL

# PostEx's own documented limit for one airway-bill PDF.
AIRWAY_BILL_MAX = 10


def _headers(token, *, pdf=False):
    return {
        "token": token,
        "Accept": "application/pdf, application/json" if pdf else "application/json",
    }


def _spring_error_message(body):
    """First line of a raw Spring 400 ("...MissingServletRequestParameter
    Exception: Required String parameter 'endDate' is not present") reduced
    to just the human part after the exception class."""
    trace = str(body.get("trace") or "")
    first = trace.split("\n", 1)[0]
    if ": " in first:
        first = first.split(": ", 1)[1]
    return first[:300] or str(body.get("message") or body.get("error") or "Bad request")


_FIELD_ERROR = re.compile(r"on field '([^']+)'.*?default message \[([^\]]*)\]\]", re.S)


def _readable_message(message):
    """create-order's validation failures come back as one long Spring
    string ("Validation failed for argument [1] in public ... [Field error
    in object '...' on field 'cityName': rejected value [null]; ...;
    default message [must not be null]]") - reduced to "cityName: must not
    be null; ...". Anything else is returned unchanged."""
    if "Field error" not in message:
        return message
    fields = _FIELD_ERROR.findall(message)
    return "; ".join(f"{field}: {text}" for field, text in fields) if fields else message[:300]


def _request(method, path, token, *, context="", expect="json", not_found_ok=False, timeout=60, **kwargs):
    """Single funnel for every PostEx call. Returns the parsed body (dict)
    for expect="json", raw bytes for expect="pdf". With not_found_ok, a
    PostEx "not found" (HTTP 404, or HTTP 200 with statusCode "404") returns
    None instead of raising - used by tracking/payment lookups where "PostEx
    doesn't know this number" is an answer, not a failure."""
    url = f"{BASE_URL}{path}"
    label = f"{method} {path}" + (f" [{context}]" if context else "")
    started = time.monotonic()

    try:
        resp = requests.request(
            method, url, headers=_headers(token, pdf=(expect == "pdf")),
            allow_redirects=False, timeout=timeout, **kwargs,
        )
    except requests.Timeout as exc:
        logger.error("postex %s -> timed out after %.2fs", label, time.monotonic() - started)
        raise PostExAPIError(f"PostEx didn't answer in time ({context or path}) - try again shortly.") from exc
    except requests.RequestException as exc:
        logger.error("postex %s -> unreachable after %.2fs: %s", label, time.monotonic() - started, exc)
        raise PostExAPIError(f"Could not reach PostEx: {exc}") from exc

    logger.info("postex %s -> HTTP %s in %.2fs (%s bytes)",
                label, resp.status_code, time.monotonic() - started, len(resp.content or b""))
    logger.debug("postex %s response body: %s", label, (resp.text or "")[:2000] if expect != "pdf" else "<pdf>")

    content_type = (resp.headers.get("Content-Type") or "").lower()

    if expect == "pdf" and resp.ok and "pdf" in content_type:
        return resp.content

    body = None
    if resp.content and "json" in content_type:
        try:
            body = resp.json()
        except ValueError:
            body = None

    if isinstance(body, dict) and "trace" in body and "statusCode" not in body:
        message = _spring_error_message(body)
        logger.error("postex %s -> HTTP %s request rejected: %s", label, resp.status_code, message)
        raise PostExAPIError(f"PostEx rejected the request ({context or path}): {message}")

    body_code = str(body.get("statusCode")) if isinstance(body, dict) and "statusCode" in body else ""
    message = _readable_message(str(body.get("statusMessage") or "")) if isinstance(body, dict) else ""

    if resp.status_code == 401 or body_code == "401":
        logger.error("postex %s -> token rejected: %s", label, message or resp.text[:200])
        raise PostExAPIError(
            "PostEx rejected the API token"
            + (f" ({message})" if message else "")
            + ". Check it on the PostEx integration page."
        )

    if resp.status_code == 404 or body_code == "404":
        if not_found_ok:
            return None
        raise PostExAPIError(f"PostEx: {message or 'not found'}")

    if body_code and body_code != "200":
        logger.error("postex %s -> HTTP %s statusCode %s: %s", label, resp.status_code, body_code, message)
        raise PostExAPIError(f"PostEx: {message or f'error {body_code}'}")

    if not resp.ok:
        logger.error("postex %s -> HTTP %s: %s", label, resp.status_code, (resp.text or "")[:500])
        raise PostExAPIError(
            f"PostEx {context or path} failed: HTTP {resp.status_code} {message or (resp.text or '')[:200]}"
        )

    if expect == "pdf":
        # HTTP 200 but not a PDF - PostEx answered with JSON instead.
        logger.error("postex %s -> expected a PDF, got %r: %s", label, content_type, (resp.text or "")[:500])
        raise PostExAPIError(
            f"PostEx didn't return a PDF for {context or path}"
            + (f": {message}" if message else f" (got {content_type or 'no content-type'}).")
        )

    if body is None:
        if not resp.content:
            return {}
        logger.error("postex %s -> HTTP %s but body was not JSON: %s",
                     label, resp.status_code, (resp.text or "")[:300])
        raise PostExAPIError(f"PostEx returned a non-JSON response to {context or path}.")
    return body


def _dist(body):
    return body.get("dist") if isinstance(body, dict) else None


def _require_token(token):
    if not token:
        raise PostExAPIError("Add your PostEx API token on the PostEx integration page first.")


# ------------------------------------------------------------ Reference --

def fetch_operational_cities(token):
    """[{"operationalCityName": "ABBOTTABAD", "countryName", "isPickupCity",
    "isDeliveryCity"}, ...] - ~900 rows, names mostly UPPER CASE (confirmed
    live)."""
    _require_token(token)
    body = _request("GET", "/v2/get-operational-city", token, context="Operational cities", timeout=90)
    rows = _dist(body)
    return rows if isinstance(rows, list) else []


def list_pickup_addresses(token, *, city_name=None):
    """[{"merchantAddressId", "address", "phone1", "phone2", "phone3",
    "wareHouseManagerName", "contactPersonName", "merchantId", "cityId",
    "cityName", "addressCode": "001", "isEditable", "addressType": "Default
    Address" | "Pickup/Return Address" | "Return Address"}] (confirmed live).
    addressCode is what create-order's pickupAddressCode takes."""
    _require_token(token)
    params = {"cityName": city_name} if city_name else None
    body = _request("GET", "/v1/get-merchant-address", token, context="Pickup addresses", params=params)
    rows = _dist(body)
    return rows if isinstance(rows, list) else []


def create_pickup_address(token, *, address, city_name, contact_person_name, phone1, phone2,
                          address_type_id=2, phone3="", warehouse_manager_name=""):
    """POST /v2/create-merchant-address. addressTypeId: 1 = Return,
    2 = Pickup. Answers {"statusCode": "200", "statusMessage"} with no id -
    re-list the addresses to find the new addressCode."""
    _require_token(token)
    body = {
        "address": address,
        "addressTypeId": int(address_type_id),
        "cityName": city_name,
        "contactPersonName": contact_person_name,
        "phone1": phone1,
        "phone2": phone2,
        "phone3": phone3 or "",
        "wareHouseManagerName": warehouse_manager_name or "",
    }
    return _request("POST", "/v2/create-merchant-address", token, context="Create pickup address", json=body)


# --------------------------------------------------------------- Orders --

def create_order(token, payload):
    """POST /v3/create-order with a payload built by postex/services.py.
    Returns dist: {"trackingNumber", "orderStatus": "UnBooked",
    "orderDate"}. PostEx books one order per call - there is no bulk
    endpoint."""
    _require_token(token)
    body = _request(
        "POST", "/v3/create-order", token,
        context=f"Create order {payload.get('orderRefNumber', '')}", json=payload, timeout=60,
    )
    dist = _dist(body)
    return dist if isinstance(dist, dict) else {}


def track_order(token, tracking_number):
    """GET /v1/track-order/{tn}. Returns dist (the order, including
    transactionStatusHistory) or {} if PostEx doesn't know the number."""
    _require_token(token)
    body = _request(
        "GET", f"/v1/track-order/{tracking_number}", token,
        context=f"Track {tracking_number}", not_found_ok=True,
    )
    dist = _dist(body) if body else None
    return dist if isinstance(dist, dict) else {}


def track_bulk(token, tracking_numbers):
    """GET /v1/track-bulk-order?TrackingNumbers=a,b,c. Returns {tn: order}
    for every number PostEx knows (rows it doesn't know come back as
    {"trackingNumber", "message": "ORDER NOT FOUND"} and are left out).
    Confirmed live with 26 numbers in one call."""
    _require_token(token)
    if not tracking_numbers:
        return {}
    body = _request(
        "GET", "/v1/track-bulk-order", token,
        context=f"Tracking {len(tracking_numbers)} order(s)",
        params={"TrackingNumbers": ",".join(tracking_numbers)}, timeout=90,
    )
    result = {}
    for row in _dist(body) or []:
        if not isinstance(row, dict):
            continue
        order = row.get("trackingResponse")
        tn = str(row.get("trackingNumber") or (order or {}).get("trackingNumber") or "")
        if tn and isinstance(order, dict):
            result[tn] = order
    return result


def list_orders(token, *, start_date, end_date, status_id=0):
    """GET /v1/get-all-order - every order created between two dates
    (yyyy-mm-dd, inclusive), optionally one status id (0 = all). Rows are
    flat order dicts (NOT wrapped in trackingResponse as the guide shows).
    Slow for long ranges: a 5-week range timed out at 60s while single days
    answer in ~2s, so callers split long ranges - see
    postex/views.py's PostExShipmentsView."""
    _require_token(token)
    body = _request(
        "GET", "/v1/get-all-order", token, context="List orders",
        params={"orderStatusId": int(status_id or 0), "startDate": start_date, "endDate": end_date},
        timeout=120,
    )
    rows = _dist(body)
    return rows if isinstance(rows, list) else []


def cancel_order(token, tracking_number):
    """PUT /v1/cancel-order {"trackingNumber"}. Per the guide only an order
    PostEx hasn't picked up yet can be cancelled; any refusal comes back as a
    non-"200" statusCode and is raised by _request."""
    _require_token(token)
    return _request(
        "PUT", "/v1/cancel-order", token,
        context=f"Cancel {tracking_number}", json={"trackingNumber": tracking_number},
    )


def payment_status(token, tracking_number):
    """{"orderRefNumber", "trackingNumber", "settle": bool, "settlementDate",
    "upfrontPaymentDate", "cprNumber_1", "reservePaymentDate", "cprNumber_2"}
    - only the keys that have values are present (confirmed live: an
    unsettled order is just {orderRefNumber, trackingNumber, settle: false}).
    {} if PostEx doesn't know the number."""
    _require_token(token)
    body = _request(
        "GET", f"/v1/payment-status/{tracking_number}", token,
        context=f"Payment status {tracking_number}", not_found_ok=True,
    )
    dist = _dist(body) if body else None
    return dist if isinstance(dist, dict) else {}


# ------------------------------------------------------------ Documents --

def airway_bill(token, tracking_numbers):
    """GET /v1/get-invoice?trackingNumbers=a,b - one PDF, at most
    AIRWAY_BILL_MAX numbers per call (the caller chunks and merges)."""
    _require_token(token)
    if not tracking_numbers:
        raise PostExAPIError("No orders to print an airway bill for.")
    if len(tracking_numbers) > AIRWAY_BILL_MAX:
        raise PostExAPIError(f"PostEx prints at most {AIRWAY_BILL_MAX} airway bills per call.")
    return _request(
        "GET", "/v1/get-invoice", token, expect="pdf",
        context=f"Airway bill for {len(tracking_numbers)} order(s)",
        params={"trackingNumbers": ",".join(tracking_numbers)}, timeout=90,
    )


def generate_load_sheet(token, tracking_numbers, *, pickup_address=""):
    """POST /v2/generate-load-sheet {"trackingNumbers": [...], "pickupAddress"}
    -> PDF. This is the hand-over step: it moves PostEx's own status from
    Unbooked to Booked so the rider collects the parcels."""
    _require_token(token)
    if not tracking_numbers:
        raise PostExAPIError("No orders to put on a load sheet.")
    body = {"trackingNumbers": list(tracking_numbers)}
    if pickup_address:
        body["pickupAddress"] = pickup_address
    return _request(
        "POST", "/v2/generate-load-sheet", token, expect="pdf",
        context=f"Load sheet for {len(tracking_numbers)} order(s)", json=body, timeout=120,
    )


# ------------------------------------------------------- Shipper advice --

# statusId values for save_shipper_advice, per the guide.
SHIPPER_ADVICE_RETURN = 1
SHIPPER_ADVICE_REATTEMPT = 2


def save_shipper_advice(token, tracking_number, *, status_id, remarks):
    _require_token(token)
    return _request(
        "PUT", "/v2/save-shipper-advice", token, context=f"Shipper advice {tracking_number}",
        json={"trackingNumber": tracking_number, "statusId": int(status_id), "remarks": remarks or ""},
    )


def get_shipper_advice(token, tracking_number):
    """[{"shipperName", "shipperContact", "customerName", "customerPhone",
    "customerAddress", "orderRefNumber", "invoicePayment", "remarks",
    "username", "remarksDate"}] - flat rows (confirmed live), not the
    guide's nested trackingResponse list."""
    _require_token(token)
    body = _request(
        "GET", f"/v1/get-shipper-advice/{tracking_number}", token,
        context=f"Shipper advice history {tracking_number}", not_found_ok=True,
    )
    rows = _dist(body) if body else None
    return rows if isinstance(rows, list) else []
