"""Business-API logic for the super admin console.

Views stay thin and this holds the behaviour, matching
core/organization_admin_service.py's shape (including its
raise-a-typed-error-with-a-status-code convention).
"""

import logging
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.core.validators import validate_slug
from django.db import IntegrityError
from django.utils import timezone

from core.rbac import write_audit_log

from .models import (
    SmartlaneBusinessConfig,
    SmartlaneCourierOffering,
    SmartlaneStoreLink,
    SmartlaneStoreWarehouse,
)
from .smartlane_client import SmartlaneAPIError
from . import smartlane_business_client as business_client

logger = logging.getLogger(__name__)


class SmartlaneBusinessError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _serialize_config(config):
    """Secrets are never echoed back - only whether they are set, matching
    SmartlaneConnectionSerializer's write-only treatment of api_key. The UI
    needs to distinguish 'not configured' from 'configured, hidden', so send
    booleans rather than the values or a masked string."""
    return {
        "business_code": config.business_code,
        "base_url": business_client.base_url(),
        "client_id": config.client_id,
        "has_client_secret": bool(config.client_secret),
        "has_jwt_token": bool(config.jwt_token),
        "is_active": config.is_active,
        "is_configured": config.is_configured,
        "last_verified_at": config.last_verified_at,
        "last_verify_error": config.last_verify_error,
        "updated_at": config.updated_at,
    }


def get_config():
    return _serialize_config(SmartlaneBusinessConfig.load())


def update_config(body):
    """Secrets are fill-only: an omitted or empty client_secret/jwt_token
    means 'leave what's stored alone', not 'erase it'. Same rule as
    SmartlaneConnectionView.post, and for the same reason - the UI can't
    show the current value, so it can't round-trip it back."""
    config = SmartlaneBusinessConfig.load()

    if "business_code" in body:
        config.business_code = (body.get("business_code") or "").strip()
    if "client_id" in body:
        config.client_id = (body.get("client_id") or "").strip()
    if "is_active" in body:
        config.is_active = bool(body.get("is_active"))

    client_secret = (body.get("client_secret") or "").strip()
    if client_secret:
        config.client_secret = client_secret

    jwt_token = (body.get("jwt_token") or "").strip()
    if jwt_token:
        config.jwt_token = jwt_token
        # A new token invalidates whatever the last check proved.
        config.last_verified_at = None
        config.last_verify_error = ""

    config.save()
    return _serialize_config(config)


def test_connection():
    """Calls Smartlane's handshake endpoint and records the outcome.

    Returns the signing inputs either way. On failure that is the whole
    point - a rejected signature is otherwise undiagnosable, and comparing
    string_to_sign against a PHP reference is what actually finds the
    mismatch.
    """
    config = SmartlaneBusinessConfig.load()
    if not config.business_code:
        raise SmartlaneBusinessError("Set the business code first.")
    if not config.jwt_token:
        raise SmartlaneBusinessError(
            "Set the Auth token first - paste the HMAC key Smartlane issued."
        )

    try:
        payload, debug = business_client.test_connection(config)
    except SmartlaneAPIError as exc:
        config.last_verified_at = None
        config.last_verify_error = str(exc)[:500]
        config.save(update_fields=["last_verified_at", "last_verify_error", "updated_at"])
        return {
            "ok": False,
            "error": str(exc),
            "debug": getattr(exc, "debug", None),
            "config": _serialize_config(config),
        }

    config.last_verified_at = timezone.now()
    config.last_verify_error = ""
    config.save(update_fields=["last_verified_at", "last_verify_error", "updated_at"])
    return {
        "ok": True,
        "response": payload,
        "debug": debug,
        "config": _serialize_config(config),
    }


# --- Courier catalog -------------------------------------------------------
# Ours, not Smartlane's: their Business API exposes no courier list. See
# SmartlaneCourierOffering's docstring for how an entry maps onto a real
# Smartlane warehouse.

_SERVICE_TYPES = {value for value, _ in SmartlaneCourierOffering.SERVICE_TYPE_CHOICES}


def _serialize_offering(offering):
    return {
        "id": offering.id,
        "key": offering.key,
        "label": offering.label,
        "carrier_name": offering.carrier_name,
        "service_type": offering.service_type,
        "warehouse_name_template": offering.warehouse_name_template,
        "auto_booking": offering.auto_booking,
        "notes": offering.notes,
        "is_active": offering.is_active,
        "sort_order": offering.sort_order,
    }


def list_offerings():
    return [_serialize_offering(o) for o in SmartlaneCourierOffering.objects.all()]


def _apply_offering_fields(offering, body):
    """Shared by create and update. `key` is handled only by create - see the
    model's note on why it is write-once."""
    if "label" in body:
        label = (body.get("label") or "").strip()
        if not label:
            raise SmartlaneBusinessError("Label is required.")
        offering.label = label

    if "carrier_name" in body:
        offering.carrier_name = (body.get("carrier_name") or "").strip()

    if "service_type" in body:
        service_type = (body.get("service_type") or "").strip()
        if service_type not in _SERVICE_TYPES:
            raise SmartlaneBusinessError(
                f"Service type must be one of: {', '.join(sorted(_SERVICE_TYPES))}."
            )
        offering.service_type = service_type

    if "warehouse_name_template" in body:
        offering.warehouse_name_template = (body.get("warehouse_name_template") or "").strip()
    if "notes" in body:
        offering.notes = (body.get("notes") or "").strip()[:500]
    if "auto_booking" in body:
        offering.auto_booking = bool(body.get("auto_booking"))
    if "is_active" in body:
        offering.is_active = bool(body.get("is_active"))
    if "sort_order" in body:
        try:
            offering.sort_order = max(0, int(body.get("sort_order") or 0))
        except (TypeError, ValueError):
            raise SmartlaneBusinessError("Sort order must be a whole number.")


def create_offering(body):
    key = (body.get("key") or "").strip().lower()
    if not key:
        raise SmartlaneBusinessError("Key is required.")
    try:
        validate_slug(key)
    except ValidationError:
        raise SmartlaneBusinessError(
            "Key must be a slug - letters, numbers, hyphens and underscores only."
        )

    offering = SmartlaneCourierOffering(key=key)
    if not (body.get("label") or "").strip():
        raise SmartlaneBusinessError("Label is required.")
    _apply_offering_fields(offering, body)

    try:
        offering.save()
    except IntegrityError:
        raise SmartlaneBusinessError(f"A courier with the key '{key}' already exists.", 409)
    return _serialize_offering(offering)


def _get_offering(offering_id):
    offering = SmartlaneCourierOffering.objects.filter(pk=offering_id).first()
    if offering is None:
        raise SmartlaneBusinessError("Courier not found.", 404)
    return offering


def update_offering(offering_id, body):
    offering = _get_offering(offering_id)
    _apply_offering_fields(offering, body)
    offering.save()
    return _serialize_offering(offering)


def delete_offering(offering_id):
    """Hard delete, refused if any org has already requested this offering -
    onboarding records reference offerings by key, so removing one in use
    would leave requests pointing at nothing. Deactivating is the everyday
    action and always works."""
    offering = _get_offering(offering_id)
    in_use = [
        link.organization_id
        for link in SmartlaneStoreLink.all_objects.exclude(status="rejected")
        if offering.key in (link.requested_offerings or [])
    ]
    if in_use:
        raise SmartlaneBusinessError(
            f"{len(in_use)} organization(s) already requested this courier. "
            "Deactivate it instead - that hides it from new requests without "
            "breaking the existing ones.",
            409,
        )
    offering.delete()


# --- Store onboarding ------------------------------------------------------

# Smartlane's doc lists human labels ("Avg order value"), not JSON keys, so
# these names are an educated guess at their wire format. Keeping the whole
# mapping in one dict means correcting it later is a single edit rather than
# a hunt. Order matters: the HMAC signature covers json_encode's output, and
# PHP preserves insertion order.
_KYC_WIRE_FIELDS = [
    ("name", "kyc_name"),
    ("logo_url", "kyc_logo_url"),
    ("poc_name", "kyc_poc_name"),
    ("poc_email", "kyc_email"),
    ("poc_phone", "kyc_phone"),
    ("poc_cnic", "kyc_poc_cnic"),
    ("platform", "kyc_platform"),
    ("address", "kyc_business_address"),
    ("city", "kyc_city"),
    ("state", "kyc_state"),
    ("industry", "kyc_industry"),
    ("ntn", "kyc_ntn"),
    ("business_years", "kyc_years_in_business"),
    ("avg_order_value", "kyc_avg_order_value"),
    ("avg_monthly_sale", "kyc_avg_monthly_sales"),
    ("annual_retail_sale", "kyc_annual_retail_sales"),
]

# What an org must fill in before it can submit. Everything else is optional
# on our side; Smartlane may disagree, which their KYC response will say.
_KYC_REQUIRED = [
    "kyc_name", "kyc_industry", "kyc_business_address", "kyc_city", "kyc_state",
    "kyc_poc_name", "kyc_email", "kyc_phone", "kyc_poc_cnic",
]


def build_kyc_payload(link):
    """The store link as Smartlane's KYC body.

    Decimals become strings rather than floats: json.dumps would render a
    Decimal as a float and change the digits, and the md5 of this body is
    what the signature covers, so a rounding difference is a rejected
    request rather than a rounding difference.
    """
    payload = {}
    for wire_key, field in _KYC_WIRE_FIELDS:
        value = getattr(link, field)
        if value is None or value == "":
            continue
        payload[wire_key] = str(value) if not isinstance(value, (int, str)) else value
    return payload


def _serialize_link(link, *, include_org=False):
    data = {
        "id": str(link.id),
        "status": link.status,
        "status_display": link.get_status_display(),
        "requested_offerings": link.requested_offerings or [],
        "smartlane_store_id": link.smartlane_store_id,
        "review_note": link.review_note,
        "requested_at": link.requested_at,
        "reviewed_at": link.reviewed_at,
        "reviewed_by_email": link.reviewed_by_email,
        "last_synced_at": link.last_synced_at,
        "kyc": {wire: getattr(link, field) for wire, field in _KYC_WIRE_FIELDS},
    }
    if include_org:
        data["organization_id"] = str(link.organization_id)
        data["organization_name"] = link.organization.name
    return data


def get_org_onboarding(organization_id):
    """What the tenant-facing page renders: their request (if any) plus the
    catalog they can pick from."""
    link = SmartlaneStoreLink.all_objects.filter(organization_id=organization_id).first()
    return {
        "link": _serialize_link(link) if link else None,
        "couriers": [
            _serialize_offering(o)
            for o in SmartlaneCourierOffering.objects.filter(is_active=True)
        ],
        # Without a configured business account there is nothing to onboard
        # onto, and the page should say so rather than take a request that
        # can never be approved.
        "available": SmartlaneBusinessConfig.load().is_configured,
    }


def submit_org_onboarding(organization_id, body, *, actor_user_id=None):
    """Create or update an org's request and put it in the approval queue.

    Editable while draft/rejected - a rejection is meant to be actionable,
    so the org fixes what the note said and resubmits. Once it is with the
    super admin or with Smartlane it is frozen.
    """
    link = SmartlaneStoreLink.all_objects.filter(organization_id=organization_id).first()
    if link is None:
        link = SmartlaneStoreLink(organization_id=organization_id)
    elif link.status not in ("draft", "rejected"):
        raise SmartlaneBusinessError(
            "This request is already being reviewed and can't be edited.", 409
        )

    for wire_key, field in _KYC_WIRE_FIELDS:
        if wire_key not in body:
            continue
        value = body.get(wire_key)
        model_field = SmartlaneStoreLink._meta.get_field(field)
        if value in (None, ""):
            setattr(link, field, None if model_field.null else "")
            continue
        if field in ("kyc_years_in_business",):
            try:
                setattr(link, field, max(0, int(value)))
            except (TypeError, ValueError):
                raise SmartlaneBusinessError("Years in business must be a whole number.")
        elif field in (
            "kyc_avg_order_value",
            "kyc_avg_monthly_sales",
            "kyc_annual_retail_sales",
        ):
            try:
                setattr(link, field, Decimal(str(value)))
            except (InvalidOperation, TypeError, ValueError):
                raise SmartlaneBusinessError(f"{wire_key.replace('_', ' ')} must be a number.")
        else:
            setattr(link, field, str(value).strip())

    if "requested_offerings" in body:
        requested = body.get("requested_offerings") or []
        if not isinstance(requested, list):
            raise SmartlaneBusinessError("requested_offerings must be a list of courier keys.")
        valid = set(
            SmartlaneCourierOffering.objects.filter(
                is_active=True, key__in=requested
            ).values_list("key", flat=True)
        )
        unknown = [k for k in requested if k not in valid]
        if unknown:
            raise SmartlaneBusinessError(f"Unknown or inactive courier: {', '.join(unknown)}.")
        link.requested_offerings = [k for k in requested if k in valid]

    missing = [
        wire
        for wire, field in _KYC_WIRE_FIELDS
        if field in _KYC_REQUIRED and not getattr(link, field)
    ]
    if missing:
        raise SmartlaneBusinessError(f"Required: {', '.join(missing)}.")
    if not link.requested_offerings:
        raise SmartlaneBusinessError("Pick at least one courier.")

    link.status = "pending_approval"
    link.review_note = ""
    link.requested_by_user_id = actor_user_id
    link.requested_at = timezone.now()
    link.save()
    return _serialize_link(link)


def list_store_links(status=None):
    qs = SmartlaneStoreLink.all_objects.select_related("organization").order_by(
        "-requested_at", "-created_at"
    )
    if status:
        qs = qs.filter(status=status)
    return [_serialize_link(link, include_org=True) for link in qs]


def _get_link(link_id):
    link = (
        SmartlaneStoreLink.all_objects.select_related("organization")
        .filter(pk=link_id)
        .first()
    )
    if link is None:
        raise SmartlaneBusinessError("Onboarding request not found.", 404)
    return link


def approve_store_link(link_id, *, actor_email=""):
    """Send an approved request on to Smartlane's own KYC review.

    Two reviews, so approving here does not make the org live - it moves
    them to in_review and Smartlane decides. If their call fails the record
    stays in pending_approval so it can be retried, rather than stranding
    it in a state that implies it was sent.
    """
    link = _get_link(link_id)
    if link.status != "pending_approval":
        raise SmartlaneBusinessError(
            f"Only requests awaiting approval can be approved (this one is {link.status}).", 409
        )

    config = SmartlaneBusinessConfig.load()
    if not config.is_configured:
        raise SmartlaneBusinessError(
            "Configure the Smartlane business account before approving requests."
        )

    try:
        response, _debug = business_client.submit_store_kyc(config, build_kyc_payload(link))
    except SmartlaneAPIError as exc:
        raise SmartlaneBusinessError(f"Smartlane rejected the KYC: {exc}", 502)

    link.status = "in_review"
    link.reviewed_by_email = actor_email or ""
    link.reviewed_at = timezone.now()
    link.review_note = ""
    link.last_submit_response = response if isinstance(response, dict) else {"raw": response}
    # Some responses carry the new store id straight away; most won't until
    # Smartlane finishes reviewing, which the store-list sync picks up.
    store_id = _extract_store_id(response)
    if store_id:
        link.smartlane_store_id = store_id
    link.save()

    _audit(
        link,
        "integrations.smartlane.store_approved",
        f"Approved Smartlane onboarding for {link.organization.name}",
        actor_email,
    )
    return _serialize_link(link, include_org=True)


def reject_store_link(link_id, *, note="", actor_email=""):
    link = _get_link(link_id)
    if link.status != "pending_approval":
        raise SmartlaneBusinessError(
            f"Only requests awaiting approval can be rejected (this one is {link.status}).", 409
        )
    note = (note or "").strip()
    if not note:
        raise SmartlaneBusinessError("Give a reason - the organization sees it.")

    link.status = "rejected"
    link.review_note = note[:500]
    link.reviewed_by_email = actor_email or ""
    link.reviewed_at = timezone.now()
    link.save()

    _audit(
        link,
        "integrations.smartlane.store_rejected",
        f"Rejected Smartlane onboarding for {link.organization.name}: {note[:200]}",
        actor_email,
    )
    return _serialize_link(link, include_org=True)


def _extract_store_id(payload):
    """Smartlane's response shape isn't documented beyond "success code and
    message", so look where a store id plausibly lives rather than assuming."""
    if not isinstance(payload, dict):
        return ""
    for container in (payload, payload.get("data") or {}, payload.get("store") or {}):
        if not isinstance(container, dict):
            continue
        for key in ("store_id", "id", "storeId"):
            value = container.get(key)
            if value not in (None, ""):
                return str(value)
    return ""


def _iter_store_rows(payload):
    """GET /store returns active/in_active/in_review sections, paginated by
    Laravel. Yields (row, status) over whatever shape actually comes back."""
    if not isinstance(payload, dict):
        return
    root = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    for status in SmartlaneStoreLink.SMARTLANE_STATUSES:
        section = root.get(status)
        if isinstance(section, dict):
            section = section.get("data")
        if not isinstance(section, list):
            continue
        for row in section:
            if isinstance(row, dict):
                yield row, status


def sync_store_links():
    """Reconcile our records against Smartlane's own store list.

    Matches on store id where we already have one, and otherwise on store
    name against the KYC name - Smartlane has no field carrying our
    organization id, so the name is the only join available until they hand
    a store id back.
    """
    config = SmartlaneBusinessConfig.load()
    if not config.is_configured:
        raise SmartlaneBusinessError("Configure the Smartlane business account first.")

    try:
        payload = business_client.list_stores(config)
    except SmartlaneAPIError as exc:
        raise SmartlaneBusinessError(str(exc), 502)

    rows = list(_iter_store_rows(payload))
    links = list(
        SmartlaneStoreLink.all_objects.exclude(status__in=("draft", "rejected"))
    )
    by_store_id = {l.smartlane_store_id: l for l in links if l.smartlane_store_id}
    by_name = {(l.kyc_name or "").strip().lower(): l for l in links if l.kyc_name}

    updated = 0
    for row, status in rows:
        store_id = _extract_store_id(row)
        name = str(row.get("name") or "").strip().lower()
        link = by_store_id.get(store_id) or (by_name.get(name) if name else None)
        if link is None:
            continue

        changed = False
        if store_id and link.smartlane_store_id != store_id:
            link.smartlane_store_id = store_id
            changed = True
        if link.status != status:
            link.status = status
            changed = True
        link.last_synced_at = timezone.now()
        link.save()
        if changed:
            updated += 1

    return {"stores_seen": len(rows), "links_updated": updated}


# --- Store warehouses -------------------------------------------------
# One per (store, requested offering) - the row that actually binds a
# booking to a carrier (see SmartlaneStoreWarehouse's docstring). Nothing
# here is wired into order booking yet; this is provisioning only, driven
# from the super admin page.


def _serialize_warehouse(wh):
    return {
        "id": wh.id,
        "offering_key": wh.offering.key,
        "offering_label": wh.offering.label,
        "smartlane_warehouse_code": wh.smartlane_warehouse_code,
        "name": wh.name,
        "status": wh.status,
        "last_synced_at": wh.last_synced_at,
        "last_provision_error": wh.last_provision_error,
    }


def list_warehouses_for_link(link):
    return [
        _serialize_warehouse(w)
        for w in SmartlaneStoreWarehouse.all_objects.filter(store_link=link).select_related(
            "offering"
        )
    ]


def build_warehouse_payload(link, offering, *, city, zip_code):
    """The doc's Add/Edit Warehouse body, in its field order. `code` is
    deliberately omitted - leaving it out is what makes Smartlane assign
    one, which is what gets stored back as smartlane_warehouse_code."""
    return {
        "name": offering.warehouse_name_for(link.organization.name),
        "shipper_name": link.kyc_poc_name,
        "shipper_email": link.kyc_email,
        "shipper_phone": link.kyc_phone,
        "address": link.kyc_business_address,
        "city": city,
        "area": "",
        "zip_code": zip_code,
        "service_type": offering.service_type,
        "auto_booking": offering.auto_booking,
    }


def _extract_warehouse_code(payload):
    if not isinstance(payload, dict):
        return ""
    for container in (payload, payload.get("data") or {}, payload.get("warehouse") or {}):
        if not isinstance(container, dict):
            continue
        for key in ("code", "warehouse_code", "store_warehouse_code"):
            value = container.get(key)
            if value not in (None, ""):
                return str(value)
    return ""


def provision_warehouse(link, offering_key, *, city, zip_code, actor_email=""):
    """Creates (or retries) one warehouse for one requested offering.

    Only legal once Smartlane has actually created the store - a
    warehouse belongs to a store_id, which doesn't exist before then.
    City/zip aren't collected on the tenant KYC form (Smartlane's doc
    doesn't list them there, only on this separate endpoint), so the admin
    supplies them here; whatever is given is saved back onto the link so a
    second courier's provisioning, or a retry, doesn't ask again.
    """
    if not link.is_live:
        raise SmartlaneBusinessError("The store must be active before provisioning warehouses.")
    if offering_key not in (link.requested_offerings or []):
        raise SmartlaneBusinessError(f"{offering_key} was not requested by this org.")
    city = (city or link.kyc_city or "").strip()
    zip_code = (zip_code or link.kyc_zip_code or "").strip()
    if not city:
        raise SmartlaneBusinessError("City is required to provision a warehouse.")

    offering = SmartlaneCourierOffering.objects.filter(key=offering_key).first()
    if offering is None:
        raise SmartlaneBusinessError(f"Unknown courier: {offering_key}.", 404)

    config = SmartlaneBusinessConfig.load()
    if not config.is_configured:
        raise SmartlaneBusinessError("Configure the Smartlane business account first.")

    warehouse, _created = SmartlaneStoreWarehouse.all_objects.get_or_create(
        store_link=link, offering=offering, defaults={"organization_id": link.organization_id}
    )

    changed = False
    if city and link.kyc_city != city:
        link.kyc_city = city
        changed = True
    if zip_code and link.kyc_zip_code != zip_code:
        link.kyc_zip_code = zip_code
        changed = True
    if changed:
        link.save(update_fields=["kyc_city", "kyc_zip_code", "updated_at"])

    payload = build_warehouse_payload(link, offering, city=city, zip_code=zip_code)
    try:
        response, _debug = business_client.add_or_edit_warehouse(
            config, link.smartlane_store_id, payload
        )
    except SmartlaneAPIError as exc:
        warehouse.status = "failed"
        warehouse.last_provision_error = str(exc)[:500]
        warehouse.save(update_fields=["status", "last_provision_error", "updated_at"])
        raise SmartlaneBusinessError(f"Smartlane rejected the warehouse: {exc}", 502)

    code = _extract_warehouse_code(response)
    warehouse.name = payload["name"]
    warehouse.status = "active" if code else "failed"
    warehouse.smartlane_warehouse_code = code or warehouse.smartlane_warehouse_code
    warehouse.last_provision_error = "" if code else "Smartlane didn't return a warehouse code."
    warehouse.last_synced_at = timezone.now()
    warehouse.save()

    _audit(
        link,
        "integrations.smartlane.warehouse_provisioned",
        f"Provisioned {offering.label} warehouse for {link.organization.name}",
        actor_email,
    )
    return _serialize_warehouse(warehouse)


def provision_all_warehouses(link, *, city=None, zip_code=None, actor_email=""):
    """Provisions every requested offering that doesn't already have an
    active warehouse. Manual, from the admin page - nothing calls this on
    its own yet."""
    existing = {
        w.offering.key: w
        for w in SmartlaneStoreWarehouse.all_objects.filter(store_link=link).select_related(
            "offering"
        )
    }
    results, errors = [], []
    for key in link.requested_offerings or []:
        if existing.get(key) and existing[key].status == "active":
            continue
        try:
            results.append(
                provision_warehouse(link, key, city=city, zip_code=zip_code, actor_email=actor_email)
            )
        except SmartlaneBusinessError as exc:
            errors.append({"offering_key": key, "error": exc.message})
    return {"provisioned": results, "errors": errors}


def get_warehouses_for_store_link(link_id):
    link = _get_link(link_id)
    return {"link": _serialize_link(link, include_org=True), "warehouses": list_warehouses_for_link(link)}


def provision_warehouses_for_store_link(link_id, body, *, actor_email=""):
    link = _get_link(link_id)
    result = provision_all_warehouses(
        link,
        city=(body.get("city") or "").strip() or None,
        zip_code=(body.get("zip_code") or "").strip() or None,
        actor_email=actor_email,
    )
    return {
        **result,
        "link": _serialize_link(link, include_org=True),
        "warehouses": list_warehouses_for_link(link),
    }


def _audit(link, action, summary, actor_email):
    """Super-admin actions have no org context of their own, so these land in
    the requesting org's log - which is also where they are most useful."""
    try:
        write_audit_log(
            organization_id=link.organization_id,
            action=action,
            summary=summary,
            actor_email=actor_email or "",
            entity_type="smartlane_store_link",
            entity_id=str(link.id),
            metadata={"status": link.status, "offerings": link.requested_offerings},
        )
    except Exception:  # noqa: BLE001 - an audit failure must not undo the action
        logger.warning("failed writing smartlane audit log for %s", link.id, exc_info=True)
