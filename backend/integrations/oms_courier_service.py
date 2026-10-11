"""The super admin's side of OMS Courier requests - the OMS Couriers tab's
Requests page. A store asks for a courier from its OMS Courier page
(integrations.oms_courier_views); here it's approved or rejected, with a
message the store sees, or corrected (edit_request). Each of those also
lands under the store's bell (core.notification_service). Only an approved
courier lets the Dispatch Hub book that store's orders through FynkTech's
account."""

import logging

from django.utils import timezone

from core.models import DispatchHubStore
from core.rbac import write_audit_log

from .models import OmsCourierEnrollment, SmartlaneStoreLink

logger = logging.getLogger(__name__)

COURIERS = dict(OmsCourierEnrollment.COURIER_CHOICES)
# The store's address type (oms_courier_views.POSTEX_ADDRESS_TYPES) as
# PostEx's create-merchant-address addressTypeId: 1 = Return, 2 = Pickup are
# its only values (Merchant API guide v4.1.9, 3.3.2), and an address made
# with 2 lists as "Pickup/Return Address" - so both pickup choices go as 2.
POSTEX_ADDRESS_TYPE_IDS = {"return": 1, "pickup": 2, "pickup_return": 2}


class OmsCourierRequestError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _smartlane_details(link):
    """Smartlane is asked for with the full business details its onboarding
    takes (SmartlaneStoreLink) - the parts worth reading before approving."""
    if link is None:
        return None
    return {
        "link_id": str(link.id),
        "status": link.status,
        "business_name": link.kyc_name,
        "industry": link.kyc_industry,
        "contact_name": link.kyc_poc_name,
        "email": link.kyc_email,
        "phone": link.kyc_phone,
        "address": link.kyc_business_address,
        "city": link.kyc_city,
        "state": link.kyc_state,
    }


def _serialize(enrollment, *, hub_ids, links):
    return {
        "id": str(enrollment.id),
        "organization_id": str(enrollment.organization_id),
        "organization_name": enrollment.organization.name,
        "in_dispatch_hub": enrollment.organization_id in hub_ids,
        "courier": enrollment.courier,
        "courier_name": COURIERS.get(enrollment.courier, enrollment.courier),
        "is_enabled": enrollment.is_enabled,
        "status": enrollment.status,
        "store_name": enrollment.store_name,
        "phone": enrollment.phone,
        "pickup_address": enrollment.pickup_address,
        "details": enrollment.details or {},
        "courier_reference": enrollment.courier_reference,
        "review_note": enrollment.review_note,
        "reviewed_by_email": enrollment.reviewed_by_email,
        "requested_at": enrollment.requested_at.isoformat() if enrollment.requested_at else None,
        "reviewed_at": enrollment.reviewed_at.isoformat() if enrollment.reviewed_at else None,
        "smartlane": (
            _smartlane_details(links.get(enrollment.organization_id))
            if enrollment.courier == OmsCourierEnrollment.COURIER_SMARTLANE
            else None
        ),
    }


def list_requests(status=None):
    """Every store's requests, newest first - `status` narrows to one of
    pending/approved/rejected."""
    qs = (
        OmsCourierEnrollment.all_objects.select_related("organization")
        .filter(organization__is_platform=False)
        .order_by("-requested_at", "-updated_at")
    )
    if status:
        qs = qs.filter(status=status)
    enrollments = list(qs)
    hub_ids = set(DispatchHubStore.objects.values_list("organization_id", flat=True))
    links = {
        link.organization_id: link
        for link in SmartlaneStoreLink.all_objects.filter(
            organization_id__in=[
                e.organization_id
                for e in enrollments
                if e.courier == OmsCourierEnrollment.COURIER_SMARTLANE
            ]
        )
    }
    return [_serialize(e, hub_ids=hub_ids, links=links) for e in enrollments]


def pending_count():
    return OmsCourierEnrollment.all_objects.filter(
        status=OmsCourierEnrollment.STATUS_PENDING, organization__is_platform=False
    ).count()


def _notify_store(enrollment, title, message="", changes=None, actor_email=""):
    """Puts the update under the store's bell. Never fails the action."""
    from core import notification_service
    from core.models import Notification

    try:
        notification_service.notify(
            enrollment.organization_id,
            kind=Notification.KIND_COURIER_REQUEST,
            title=title,
            message=message,
            changes=changes,
            actor_email=actor_email,
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not notify the store about its %s request", enrollment.courier)


def _find(enrollment_id):
    enrollment = (
        OmsCourierEnrollment.all_objects.select_related("organization").filter(id=enrollment_id).first()
    )
    if enrollment is None:
        raise OmsCourierRequestError("Request not found.", 404)
    return enrollment


def _get(enrollment_id):
    enrollment = _find(enrollment_id)
    if enrollment.status != OmsCourierEnrollment.STATUS_PENDING:
        raise OmsCourierRequestError(
            f"Only pending requests can be answered (this one is {enrollment.status}).", 409
        )
    return enrollment


def _audit(enrollment, action, verb, message, actor_email):
    write_audit_log(
        organization_id=enrollment.organization_id,
        action=action,
        summary=(
            f"{verb} {COURIERS.get(enrollment.courier, enrollment.courier)} through OMS Courier"
            + (f": {message[:200]}" if message else "")
        ),
        actor_email=actor_email,
        entity_type="oms_courier_enrollment",
        entity_id=str(enrollment.id),
    )


def _create_postex_address(enrollment):
    """Adds the store's address form to FynkTech's PostEx account as a
    pickup address and returns the addressCode PostEx gave it - what every
    booking of this store's orders through that account then picks up from.
    PostEx's create answers without the code, so the address list is read
    before and after and the new one found by diffing (same as the PostEx
    page's own "Add pickup address")."""
    from .postex import client as postex_client
    from .postex import services as postex_services
    from .postex.exceptions import PostExAPIError

    connection = postex_services.platform_connection()
    if connection is None:
        raise OmsCourierRequestError(
            "Connect FynkTech's PostEx account on the OMS Couriers tab before approving."
        )
    form = enrollment.details or {}
    if not form.get("address") or not form.get("city"):
        raise OmsCourierRequestError(
            "This request has no PostEx address details - reject it so the store sends the form."
        )
    try:
        before = {
            str(a.get("addressCode")) for a in postex_client.list_pickup_addresses(connection.api_token)
        }
        # Paired as the guide describes the fields (3.3.2): the contact person
        # with phone1/phone2 (both mandatory - Contact#2 falls back to
        # Contact#1), the shipper as the warehouse manager with phone3.
        phone1 = form.get("contact_1") or form.get("shipper_contact") or ""
        postex_client.create_pickup_address(
            connection.api_token,
            address=form["address"],
            city_name=form["city"],
            contact_person_name=form.get("contact_person_name") or form.get("shipper_name") or "",
            phone1=phone1,
            phone2=form.get("contact_2") or phone1,
            phone3=form.get("shipper_contact") or "",
            warehouse_manager_name=form.get("shipper_name") or "",
            address_type_id=POSTEX_ADDRESS_TYPE_IDS.get(form.get("address_type"), 2),
        )
        after = postex_client.list_pickup_addresses(connection.api_token)
    except PostExAPIError as exc:
        raise OmsCourierRequestError(f"PostEx didn't accept the address: {exc}", 502) from exc

    new_rows = [a for a in after if str(a.get("addressCode")) not in before]
    if len(new_rows) > 1:
        # Another address was added at the same moment - keep this one's.
        new_rows = [
            a for a in new_rows if str(a.get("address") or "").strip() == form["address"]
        ] or new_rows
    if not new_rows:
        raise OmsCourierRequestError(
            "PostEx accepted the address but it isn't in the account's address list yet - "
            "check FynkTech's PostEx page before approving again.",
            502,
        )
    return str(new_rows[0].get("addressCode") or "")


def _create_barqraftar_address(enrollment):
    """Adds the store's address form to FynkTech's BarqRaftar account as a
    pickup address (company_addresses/store, named after the store) and
    returns the pickup_address_id BarqRaftar answers with - every booking of
    this store's orders through that account then picks up from it, with
    its city as from_city_id (barqraftar.services.store_pickup)."""
    from .barqraftar import client as barqraftar_client
    from .barqraftar import services as barqraftar_services
    from .barqraftar.client import BarqRaftarAPIError

    connection = barqraftar_services.platform_connection()
    if connection is None:
        raise OmsCourierRequestError(
            "Connect FynkTech's BarqRaftar account on the OMS Couriers tab before approving."
        )
    form = enrollment.details or {}
    if not form.get("address") or not form.get("city_id"):
        raise OmsCourierRequestError(
            "This request has no BarqRaftar address details - reject it so the store sends the form."
        )
    try:
        result = barqraftar_client.save_pickup_address(
            connection.api_key, connection.api_secret,
            name=form.get("name") or enrollment.store_name,
            address=form["address"],
            city_id=form["city_id"],
            person_of_contact=form.get("person_of_contact") or "",
            phone_number=form.get("phone_number") or "",
            latitude=form.get("latitude") or None,
            longitude=form.get("longitude") or None,
        )
    except BarqRaftarAPIError as exc:
        raise OmsCourierRequestError(f"BarqRaftar didn't accept the address: {exc}", 502) from exc
    address_id = result.get("pickup_address_id") if isinstance(result, dict) else None
    if not address_id:
        raise OmsCourierRequestError(
            "BarqRaftar answered without a pickup address id - check FynkTech's BarqRaftar page "
            "before approving again.",
            502,
        )
    return str(address_id)


# Courier -> what approving first creates on FynkTech's account for it,
# returning the reference bookings then use (courier_reference).
_ON_APPROVE = {
    OmsCourierEnrollment.COURIER_POSTEX: _create_postex_address,
    OmsCourierEnrollment.COURIER_BARQRAFTAR: _create_barqraftar_address,
}


def approve_request(enrollment_id, *, message="", actor_email=""):
    """Approves a request. A PostEx or BarqRaftar one first becomes a pickup
    address on FynkTech's account for it (_ON_APPROVE) - if the courier
    refuses it, the request stays pending and the reason comes back."""
    enrollment = _get(enrollment_id)
    message = (message or "").strip()[:500]
    create_address = _ON_APPROVE.get(enrollment.courier)
    if create_address is not None:
        enrollment.courier_reference = create_address(enrollment)
    enrollment.status = OmsCourierEnrollment.STATUS_APPROVED
    enrollment.review_note = message
    enrollment.reviewed_by_email = actor_email or ""
    enrollment.reviewed_at = timezone.now()
    enrollment.save(
        update_fields=[
            "status", "courier_reference", "review_note", "reviewed_by_email", "reviewed_at",
            "updated_at",
        ]
    )
    _audit(enrollment, "oms_courier.approved", "Approved", message, actor_email)
    name = COURIERS.get(enrollment.courier, enrollment.courier)
    _notify_store(
        enrollment, f"FynkTech approved your {name} request", message, actor_email=actor_email,
    )
    return _serialize_one(enrollment)


def reject_request(enrollment_id, *, message="", actor_email=""):
    enrollment = _get(enrollment_id)
    message = (message or "").strip()[:500]
    if not message:
        raise OmsCourierRequestError("Give a reason - the store sees it.")

    if enrollment.courier == OmsCourierEnrollment.COURIER_SMARTLANE:
        link = SmartlaneStoreLink.all_objects.filter(organization_id=enrollment.organization_id).first()
        if link is not None and link.status == "pending_approval":
            # The business details themselves go back to the store too, so
            # its "Fix and resubmit" can edit them (a request still waiting
            # for approval can't be). reject_store_link also rejects this
            # request, with the same reason.
            from . import business_services

            business_services.reject_store_link(link.id, note=message, actor_email=actor_email)
            enrollment.refresh_from_db()
            _audit(enrollment, "oms_courier.rejected", "Rejected", message, actor_email)
            _notify_rejected(enrollment, message, actor_email)
            return _serialize_one(enrollment)

    enrollment.status = OmsCourierEnrollment.STATUS_REJECTED
    enrollment.is_enabled = False
    enrollment.review_note = message
    enrollment.reviewed_by_email = actor_email or ""
    enrollment.reviewed_at = timezone.now()
    enrollment.save(
        update_fields=[
            "status", "is_enabled", "review_note", "reviewed_by_email", "reviewed_at", "updated_at",
        ]
    )
    _audit(enrollment, "oms_courier.rejected", "Rejected", message, actor_email)
    _notify_rejected(enrollment, message, actor_email)
    return _serialize_one(enrollment)


def _notify_rejected(enrollment, message, actor_email):
    name = COURIERS.get(enrollment.courier, enrollment.courier)
    _notify_store(
        enrollment, f"FynkTech rejected your {name} request", message, actor_email=actor_email,
    )


def _form_labels(courier):
    """{field: label} of what a request's form shows - its courier's own
    address form, or the generic three fields."""
    from .oms_courier_views import BARQRAFTAR_FIELDS, DETAIL_FIELDS, POSTEX_FIELDS

    fields = {
        OmsCourierEnrollment.COURIER_POSTEX: POSTEX_FIELDS,
        OmsCourierEnrollment.COURIER_BARQRAFTAR: BARQRAFTAR_FIELDS,
    }.get(courier)
    if fields is None:
        return {field: label for field, (label, _) in DETAIL_FIELDS.items()}
    # BarqRaftar's city shows as its name; the id beside it is bookkeeping.
    return {field: spec[0] for field, spec in fields.items() if field != "city_id"}


def _shown(field, value):
    from .oms_courier_views import POSTEX_ADDRESS_TYPES

    if field == "address_type":
        value = POSTEX_ADDRESS_TYPES.get(value, value)
    return value or "-"


def edit_request(enrollment_id, body, *, actor_email=""):
    """The super admin correcting a store's request - its courier's own form
    fields, cleaned exactly as the store's own submit is. A pending request
    just takes the new values. An approved PostEx/BarqRaftar one already has
    its pickup address on FynkTech's account, and neither courier can edit
    one (PostEx has no API for it; BarqRaftar's "update" makes a new
    address), so a changed address is added as a new one there and the
    store's bookings move to its code. A rejected request is the store's to
    fix and resend. The store is told what changed."""
    from .oms_courier_views import COURIER_FORMS, _clean_generic

    enrollment = _find(enrollment_id)
    if enrollment.status == OmsCourierEnrollment.STATUS_REJECTED:
        raise OmsCourierRequestError(
            "A rejected request is fixed and sent again by the store.", 409
        )
    clean = COURIER_FORMS.get(enrollment.courier, _clean_generic)
    details, generic, problem = clean(body or {})
    if problem:
        raise OmsCourierRequestError(problem)

    own_form = enrollment.courier in COURIER_FORMS
    old_values = (enrollment.details or {}) if own_form else {
        f: getattr(enrollment, f) for f in generic
    }
    new_values = details if own_form else generic
    changes = [
        {"field": field, "label": label,
         "old": _shown(field, old_values.get(field)), "new": _shown(field, new_values.get(field))}
        for field, label in _form_labels(enrollment.courier).items()
        if (old_values.get(field) or "") != (new_values.get(field) or "")
    ]
    if not changes and (not own_form or (enrollment.details or {}) == details):
        return _serialize_one(enrollment)

    old_reference = enrollment.courier_reference
    enrollment.details = details
    for field, value in generic.items():
        setattr(enrollment, field, value)
    create_address = _ON_APPROVE.get(enrollment.courier)
    if enrollment.status == OmsCourierEnrollment.STATUS_APPROVED and create_address is not None:
        # Nothing is saved if the courier refuses the new address.
        enrollment.courier_reference = create_address(enrollment)
        changes.append({
            "field": "courier_reference",
            "label": "Pickup address code" if enrollment.courier == OmsCourierEnrollment.COURIER_POSTEX
            else "Pickup address ID",
            "old": old_reference or "-",
            "new": enrollment.courier_reference,
        })
    enrollment.save()

    name = COURIERS.get(enrollment.courier, enrollment.courier)
    summary = "; ".join(f"{c['label']}: {c['old']} -> {c['new']}" for c in changes[:3])
    if len(changes) > 3:
        summary += f" (+{len(changes) - 3} more)"
    _audit(enrollment, "oms_courier.edited", "Edited", summary, actor_email)
    _notify_store(
        enrollment, f"FynkTech updated your {name} request", summary, changes=changes,
        actor_email=actor_email,
    )
    return _serialize_one(enrollment)


def _serialize_one(enrollment):
    """One request in list_requests' shape."""
    hub_ids = set(
        DispatchHubStore.objects.filter(organization_id=enrollment.organization_id)
        .values_list("organization_id", flat=True)
    )
    links = {
        link.organization_id: link
        for link in SmartlaneStoreLink.all_objects.filter(organization_id=enrollment.organization_id)
    }
    return _serialize(enrollment, hub_ids=hub_ids, links=links)
