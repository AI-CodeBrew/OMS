"""Client for Smartlane's *Business* API.

Deliberately separate from smartlane_client.py rather than a branch inside
it: that one authenticates as a single store with a bearer key, this one
authenticates as a business with an HMAC signature and addresses stores by
id underneath it. The only thing they share is the SmartlaneAPIError type,
so callers upstream still have one exception to catch.

Signing matches Smartlane's GenerateHmacSignatureAction (PHP):

    body     = GET ? {verb: GET} : request_body
    jsonBody = json_encode(body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    string   = VERB + "\\n" + url + "\\n" + md5(jsonBody)
    hash     = hash_hmac('SHA256', string, api_token)   # hex, not raw
    signature = base64_encode(hash)
    header   X-SMART-LANE-SIGNATURE

The HMAC `url` is always the business root
(`https://gcp.smartlane.dev/business/{businessCode}`), even when the
request is POST /{code}/store/new/kyc. Ali: generate url stays the same.
Signing the request path is what produced 403 Invalid Authentication Code
while Postman (root URL) succeeded.

Each ambiguous flag is isolated on SignatureOptions so a rejected
signature can be diagnosed by flipping one switch. See that class.
"""

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import requests
from django.conf import settings

from .smartlane_client import SmartlaneAPIError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SignatureOptions:
    """Every documented-but-ambiguous part of the signing spec, in one place.

    The defaults are the most faithful reading of the PHP in the doc. If
    Smartlane rejects a signature, change one of these at a time and
    compare the resulting string_to_sign against a PHP reference - the
    debug payload returned by test_connection() prints it.
    """

    # PHP_EOL is "\n" on Linux (their Laravel host) and "\r\n" on Windows.
    eol: str = "\n"
    # PHP's json_encode writes {"a":1}, Python's default writes {"a": 1}.
    # A single space here changes the md5 and so the whole signature.
    compact_separators: bool = True
    # The doc's PHP snippet implies json_encode's default (escaped), but
    # Smartlane's own reference client (Node.js, using JSON.stringify -
    # which does NOT escape slashes) is what they actually test against.
    # Trust the reference code over the doc's PHP pseudocode: default to
    # unescaped. The KYC payload carries a logo URL, so this one decides
    # real requests, not just theory - this was very likely the actual
    # cause of every KYC submission being rejected.
    escape_slashes: bool = False
    # The doc says: "In case of GET if request body is empty, replace
    # {request_body_array} with verb: GET". Read as an array ["verb" =>
    # "GET"], which is what json_encode would be given. The alternative
    # reading - substituting the literal string "GET" for the whole md5 -
    # is available via this flag.
    get_body_literal: bool = False
    # Whether ?query=params are part of the signed url. The doc's examples
    # are all bare paths, so this is untested either way.
    sign_query_string: bool = True
    # PHP hash_hmac('sha256', ...) with no 4th arg returns hex. Passing
    # True would return raw bytes. Smartlane's check matches the default
    # (hex, then base64). Keep the raw path as a diagnostic switch only.
    hmac_raw: bool = False
    # Working Postman generateMacSignature always hashes this URL, even
    # when the request is POST /{code}/store/new/kyc:
    #   https://gcp.smartlane.dev/business/{businessCode}
    sign_business_root: bool = True


DEFAULT_SIGNATURE_OPTIONS = SignatureOptions()


def _json_encode(payload, options):
    """json.dumps bent to match PHP's json_encode defaults.

    Key order is insertion order in both languages, so callers must build
    payload dicts in the order the doc lists the fields. Never sort here.
    """
    separators = (",", ":") if options.compact_separators else (", ", ": ")
    encoded = json.dumps(payload, separators=separators, ensure_ascii=False)
    if options.escape_slashes:
        encoded = encoded.replace("/", "\\/")
    return encoded


def build_string_to_sign(method, url, body, options=DEFAULT_SIGNATURE_OPTIONS):
    """Returns (string_to_sign, body_bytes_to_send).

    body_bytes is returned alongside because the signature covers the
    exact bytes - handing requests a dict for it to re-serialize would
    sign one thing and send another.
    """
    method = method.upper()

    if body is None:
        if options.get_body_literal:
            body_digest_source = "GET"
        else:
            body_digest_source = _json_encode({"verb": method}, options)
        body_bytes = None
    else:
        body_digest_source = _json_encode(body, options)
        body_bytes = body_digest_source.encode("utf-8")

    body_md5 = hashlib.md5(body_digest_source.encode("utf-8")).hexdigest()
    string_to_sign = f"{method}{options.eol}{url}{options.eol}{body_md5}"
    return string_to_sign, body_bytes


def sign(method, url, body, jwt_token, options=DEFAULT_SIGNATURE_OPTIONS):
    string_to_sign, body_bytes = build_string_to_sign(method, url, body, options)
    digest = hmac.new(
        jwt_token.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    )
    hashed = digest.digest() if options.hmac_raw else digest.hexdigest().encode("ascii")
    return base64.b64encode(hashed).decode("ascii"), string_to_sign, body_bytes


def base_url():
    return settings.SMARTLANE_BUSINESS_API_BASE_URL.rstrip("/")


def build_url(path, params=None):
    url = f"{base_url()}{path}"
    if params:
        url = f"{url}?{urlencode(params)}"
    return url


def _request(
    config,
    method,
    path,
    *,
    body=None,
    params=None,
    context="",
    options=DEFAULT_SIGNATURE_OPTIONS,
    capture_debug=False,
):
    """Single funnel for every Business API call.

    Mirrors smartlane_client._request's contract deliberately: same logging
    shape, same allow_redirects=False reasoning (a 3xx off /business/ only
    ever means auth bounced us to a login page, and following it turns a
    credentials problem into a confusing error from an unrelated URL), and
    the same SmartlaneAPIError for every failure.

    capture_debug attaches the signing inputs to the raised error, which is
    what makes a rejected signature diagnosable from the super-admin page
    instead of from server logs.
    """
    if not config or not config.jwt_token:
        raise SmartlaneAPIError(
            "No Smartlane business token configured. Add the Auth token "
            "Smartlane issued on the Smartlane page in the super admin console."
        )

    request_url = build_url(path, params)
    if options.sign_business_root and config.business_code:
        signed_url = build_url(f"/{config.business_code}")
    else:
        signed_url = build_url(path, params if options.sign_query_string else None)
    signature, string_to_sign, body_bytes = sign(
        method, signed_url, body, config.jwt_token, options
    )

    headers = {
        "X-SMART-LANE-SIGNATURE": signature,
        "Accept": "application/json",
    }
    if body_bytes is not None:
        # Only on requests that actually carry a JSON body. A real,
        # working Postman GET (same token, same signature, same URL,
        # confirmed accepted by Smartlane) sends neither this nor an
        # Authorization header at all - both were added earlier from a
        # Node.js reference snippet that turned out not to match what
        # their server actually expects. Sending Content-Type on a
        # bodyless GET is the likely reason every GET through this
        # client kept getting "Invalid Authentication Code" despite a
        # byte-for-byte correct signature.
        headers["Content-Type"] = "application/json"

    label = f"{method} {path}" + (f" [{context}]" if context else "")
    started = time.monotonic()

    debug = {
        "method": method,
        "signed_url": signed_url,
        "request_url": request_url,
        "string_to_sign": string_to_sign,
        "signature": signature,
        "body_sent": body_bytes.decode("utf-8") if body_bytes else None,
    }

    def fail(message):
        # Logged at error level regardless of LOG_LEVEL, so this shows up
        # in `fly logs` by default - not just in the browser's Test Connection
        # panel, which only exists for calls made interactively from the
        # super-admin page. A booking or webhook call has no UI to show
        # this in, so the server log is the only place it will ever be
        # seen. json.dumps rather than %s-formatting the dict so the
        # string_to_sign's embedded newlines don't fragment across log
        # lines and make the entry hard to copy out whole.
        logger.error(
            "smartlane-business %s FAILED - signing detail: %s",
            label,
            json.dumps(debug, indent=2, default=str),
        )
        error = SmartlaneAPIError(message)
        if capture_debug:
            error.debug = debug
        return error

    try:
        resp = requests.request(
            method,
            request_url,
            headers=headers,
            data=body_bytes,
            allow_redirects=False,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.error(
            "smartlane-business %s -> unreachable after %.2fs: %s",
            label, time.monotonic() - started, exc,
        )
        raise fail(f"Could not reach Smartlane: {exc}") from exc

    elapsed = time.monotonic() - started
    logger.info(
        "smartlane-business %s -> HTTP %s in %.2fs (%s bytes)",
        label, resp.status_code, elapsed, len(resp.content or b""),
    )
    logger.debug("smartlane-business %s response body: %s", label, (resp.text or "")[:2000])

    debug["status_code"] = resp.status_code
    debug["response_body"] = (resp.text or "")[:2000]

    if resp.is_redirect or resp.is_permanent_redirect:
        location = resp.headers.get("Location", "")
        logger.error("smartlane-business %s -> HTTP %s redirect to %r", label, resp.status_code, location)
        raise fail(
            "Smartlane redirected instead of answering. The HMAC was likely "
            f"rejected. Signed {signed_url!r}, requested {request_url!r}."
        )

    if resp.status_code in (401, 403):
        logger.error(
            "smartlane-business %s -> HTTP %s unauthorised: %s",
            label, resp.status_code, (resp.text or "")[:300],
        )
        raise fail(
            f"Smartlane rejected the HMAC (HTTP {resp.status_code}). "
            f"Signed {signed_url!r}, requested {request_url!r}. "
            f"Response: {(resp.text or '')[:200]}"
        )

    if not resp.ok:
        logger.error(
            "smartlane-business %s -> HTTP %s: %s", label, resp.status_code, (resp.text or "")[:500]
        )
        raise fail(f"{context or path} failed: HTTP {resp.status_code} {(resp.text or '')[:300]}")

    if not resp.content:
        return {}, debug

    try:
        return resp.json(), debug
    except ValueError:
        # The handshake endpoint answers with a bare string, not JSON, so a
        # non-JSON 200 is only an error when the caller wanted JSON.
        return {"raw": resp.text}, debug


def test_connection(config, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /business/{business_code} - Smartlane's own handshake endpoint.

    The cheapest possible proof that the signature, token and business
    code are correct: it takes no arguments and should answer
    'Business API - Version 1.0'.
    """
    if not config or not config.business_code:
        raise SmartlaneAPIError("No business code configured.")

    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}",
        context="Business API handshake",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def submit_store_kyc(config, kyc, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/new/kyc - sends a store for Smartlane's review.

    `kyc` must already be in Smartlane's wire shape and field order; see
    business_services.build_kyc_payload. HMAC is signed against the
    business root; this path is only the request URL.
    """
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/new/kyc",
        body=kyc,
        context="Store KYC",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def list_stores(config, search=None, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/store/list - every store under the business,
    split active/in_active/in_review.

    The doc claimed this path was /business/store with no business code -
    confirmed wrong against Smartlane's own Postman collection, which
    shows it business-code-scoped with a /list suffix like every other
    store endpoint.
    """
    params = {"search": search} if search else None
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/store/list",
        params=params,
        context="Store list",
        options=options,
        capture_debug=True,
    )
    return payload, debug


# --- Store warehouses --------------------------------------------------
# Per the doc, this is where a store's booking is bound to a carrier - see
# SmartlaneCourierOffering's docstring. Endpoints are store_id-scoped, on
# top of the business code every other call already carries.


def list_warehouses(config, store_id, search=None, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/store/{store_id}/warehouse"""
    params = {"search": search} if search else None
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/store/{store_id}/warehouse",
        params=params,
        context="Warehouse list",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def add_or_edit_warehouse(config, store_id, warehouse, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/warehouse

    `warehouse` must already be in the doc's field order/shape; see
    business_services.build_warehouse_payload. To revoke rather than
    create, the doc says to POST again with status set to revoke - callers
    do that by including a `code` (their code) and `status: "revoke"` in
    the payload rather than this function branching on it.
    """
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/warehouse",
        body=warehouse,
        context="Add/edit warehouse",
        options=options,
        capture_debug=True,
    )
    return payload, debug


# --- Consignments --------------------------------------------------------
# Per the doc: "Following are the API list already integrated with pixel
# one. Their request and response will remain same. Only the Endpoint
# will be changed." - i.e. these bodies are the same shape as the
# existing per-org client's (smartlane_client.py), just signed and
# addressed differently. business_services.py reuses that module's body
# builders rather than redefining them here, so the mapping only exists
# in one place.


def create_consignment(config, store_id, body, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/consignment/create"""
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/create",
        body=body,
        context="Create consignment",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def track_consignment(config, store_id, store_order_ids, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/consignment/track

    The doc implies GET with query params; Smartlane's own Postman
    collection shows this as POST with a JSON body instead - confirmed
    wrong, corrected here.
    """
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/track",
        body={"store_order_id": [str(oid) for oid in store_order_ids]},
        context="Track consignment",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def cancel_consignment(config, store_id, store_order_id, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/consignment/cancel"""
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/cancel",
        body={"store_order_id": str(store_order_id)},
        context="Cancel consignment",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def fetch_airway_bill(config, store_id, store_order_ids, *, no_of_prints=1, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/consignment/airway/bill

    The doc implies GET with query params and a path with no slash
    ("airwaybill"); Smartlane's own Postman collection shows POST with a
    JSON body and the path split ("airway/bill") - confirmed wrong on
    both counts, corrected here.
    """
    if not store_order_ids:
        raise SmartlaneAPIError("No orders to print an airway bill for.")
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/airway/bill",
        body={"store_order_id": [str(oid) for oid in store_order_ids], "no_of_prints": str(no_of_prints)},
        context="Airway bill",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def fetch_load_sheet(
    config, store_id, *, courier=None, store_order_ids=None, start_date=None, end_date=None,
    options=DEFAULT_SIGNATURE_OPTIONS,
):
    """POST /{businessCode}/store/{store_id}/consignment/load_sheet

    The doc implies GET with flat query params and path "loadsheet";
    Smartlane's own Postman collection shows POST with a nested
    `filters` body and path "load_sheet" (underscore) - confirmed wrong,
    corrected here.
    """
    if not store_order_ids and not (start_date and end_date):
        raise SmartlaneAPIError("Provide store_order_ids or both start_date and end_date.")
    filters = {
        "store_order_ids": [str(oid) for oid in store_order_ids] if store_order_ids else [],
        "courier": courier or "",
        "date_range": {"start_date": start_date or "", "end_date": end_date or ""},
    }
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/load_sheet",
        body={"filters": filters},
        context="Load sheet",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def get_shipper_advice(config, store_id, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/store/{store_id}/consignment/shipper/advice

    Path segment is "advice", not "advise" as the doc's prose spelled
    it - confirmed against Smartlane's own Postman collection.
    """
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/store/{store_id}/consignment/shipper/advice",
        context="Shipper advice",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def update_shipper_advice(config, store_id, body, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/consignment/shipper/advice

    `body` per the doc/Postman example: consignment_number,
    store_order_id, courier, reason, remarks, action ("Return" or
    "Reattempt"). Same path-spelling correction as get_shipper_advice.
    """
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/consignment/shipper/advice",
        body=body,
        context="Update shipper advice",
        options=options,
        capture_debug=True,
    )
    return payload, debug


# --- Business-level lookups ---------------------------------------------
# No store_id - these describe the business account itself, or feed
# dropdowns (industries, cities) on forms like the KYC one.


def fetch_industries(config, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/smartlane/industries"""
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/smartlane/industries",
        context="Industries",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def fetch_city_list(config, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/smartlane/city"""
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/smartlane/city",
        context="City list",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def fetch_finance_products(config, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/finance/products - business-level, no store_id."""
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/finance/products",
        context="Finance products",
        options=options,
        capture_debug=True,
    )
    return payload, debug


# --- Store-level: activity log and finance -------------------------------


def fetch_activity_log(config, store_id, search=None, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/store/{store_id}/activity/log?type=...

    `search` is the doc's own param name for this - Postman's example
    uses it to filter by log type (e.g. "consignment_status").
    """
    params = {"type": search} if search else None
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/store/{store_id}/activity/log",
        params=params,
        context="Activity log",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def fetch_finance_information(config, store_id, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/store/{store_id}/finance/information"""
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/store/{store_id}/finance/information",
        context="Finance information",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def apply_finance(config, store_id, product_code, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/store/{store_id}/finance/application"""
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/store/{store_id}/finance/application",
        body={"product_code": product_code},
        context="Apply finance",
        options=options,
        capture_debug=True,
    )
    return payload, debug


# --- Business-level webhooks ----------------------------------------------


def list_webhooks(config, store_id=None, options=DEFAULT_SIGNATURE_OPTIONS):
    """GET /{businessCode}/web/hook?store_id=...

    Business-level endpoint (no store_id in the path), but Smartlane's
    own example still passes store_id as a query filter.
    """
    params = {"store_id": store_id} if store_id else None
    payload, debug = _request(
        config,
        "GET",
        f"/{config.business_code}/web/hook",
        params=params,
        context="Webhook list",
        options=options,
        capture_debug=True,
    )
    return payload, debug


def register_webhook(config, store_id, webhook_type, url, options=DEFAULT_SIGNATURE_OPTIONS):
    """POST /{businessCode}/web/hook

    Body per Postman's example: store_id, type, url. Registering again
    for the same store_id/type updates the existing registration rather
    than creating a duplicate, per the doc.
    """
    payload, debug = _request(
        config,
        "POST",
        f"/{config.business_code}/web/hook",
        body={"store_id": store_id, "type": webhook_type, "url": url},
        context="Webhook register",
        options=options,
        capture_debug=True,
    )
    return payload, debug
