"""Client for Smartlane's *Business* API.

Deliberately separate from smartlane_client.py rather than a branch inside
it: that one authenticates as a single store with a bearer key, this one
authenticates as a business with an HMAC signature and addresses stores by
id underneath it. The only thing they share is the SmartlaneAPIError type,
so callers upstream still have one exception to catch.

Signing, per Smartlane's "Business API Draft 1.0":

    string = VERB + PHP_EOL + url + PHP_EOL + md5(json_encode(body))
    hash   = base64_encode(hash_hmac('sha256', string, <shared JWT token>))
    header X-SMART-LANE-SIGNATURE: <hash>

PHP's hash_hmac() returns a hex string unless the 4th argument is true, so
the hash they actually check is base64(hex(hmac-sha256)), not base64 of the
raw digest. Confirmed against GET /business/{code}: raw-digest HMAC is
rejected as "Invalid Authentication Code"; hex-then-base64 returns 200
"Business API - Version 1.0".

That spec is a PHP snippet, and reproducing it in Python has several ways
to be silently wrong - every one of them produces a valid-looking request
that Smartlane rejects with no useful error. Each is isolated as a flag
below so a rejected signature is diagnosed by flipping one switch at a
time rather than rewriting this function. See SignatureOptions.
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
    # PHP's json_encode escapes forward slashes as \/ unless the caller
    # passes JSON_UNESCAPED_SLASHES. The KYC payload carries a logo URL,
    # so this one decides real requests, not just theory.
    escape_slashes: bool = True
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

    url = build_url(path, params if options.sign_query_string else None)
    request_url = build_url(path, params)
    signature, string_to_sign, body_bytes = sign(method, url, body, config.jwt_token, options)

    headers = {
        "X-SMART-LANE-SIGNATURE": signature,
        "Accept": "application/json",
    }
    if body_bytes is not None:
        headers["Content-Type"] = "application/json"

    label = f"{method} {path}" + (f" [{context}]" if context else "")
    started = time.monotonic()

    debug = {
        "method": method,
        "signed_url": url,
        "request_url": request_url,
        "string_to_sign": string_to_sign,
        "signature": signature,
        "body_sent": body_bytes.decode("utf-8") if body_bytes else None,
    }

    def fail(message):
        # Logged at error level regardless of LOG_LEVEL, so this shows up
        # on Render by default - not just in the browser's Test Connection
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
            "Smartlane redirected to a login page instead of answering. That usually "
            "means the signature was rejected, the token has expired, or this machine's "
            "IP is not the one registered in the business portal."
        )

    if resp.status_code in (401, 403):
        logger.error(
            "smartlane-business %s -> HTTP %s unauthorised: %s",
            label, resp.status_code, (resp.text or "")[:300],
        )
        raise fail(
            f"Smartlane rejected the request (HTTP {resp.status_code}). Check the token, "
            f"the business code, and that this machine's public IP matches the one "
            f"registered in the business portal. Response: {(resp.text or '')[:200]}"
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

    The cheapest possible proof that the signature, token, business code and
    source IP are all correct: it takes no arguments and should answer
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
    business_services.build_kyc_payload, which is the single place that
    mapping lives. The doc lists human labels ("Avg order value") rather
    than JSON keys, so the exact names are an educated guess and may need
    correcting once Smartlane confirms them.
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
    """GET /store - every store under the business, split active/in_active/in_review.

    Note the path: the doc gives this one as /business/store, with no
    business code, while every other endpoint is /business/{code}/...
    That inconsistency is theirs, and is reproduced faithfully here rather
    than "corrected" - worth confirming with them.
    """
    params = {"search": search} if search else None
    payload, _ = _request(
        config, "GET", "/store", params=params, context="Store list", options=options
    )
    return payload
