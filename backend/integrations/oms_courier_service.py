"""The super admin's side of OMS Courier requests - the OMS Couriers tab's
Requests page. A store asks for a courier from its OMS Courier page
(integrations.oms_courier_views); here it's approved or rejected, with a
message the store sees. Only an approved courier lets the Dispatch Hub book
that store's orders through FynkTech's account."""

from django.utils import timezone

from core.models import DispatchHubStore
from core.rbac import write_audit_log

from .models import OmsCourierEnrollment, SmartlaneStoreLink

COURIERS = dict(OmsCourierEnrollment.COURIER_CHOICES)
# The store's address type (oms_courier_views.POSTEX_ADDRESS_TYPES) as
# PostEx's create-merchant-address addressTypeId. Its API knows 1 (Return)
# and 2 (Pickup) - an address made with 2 lists as "Pickup/Return Address" -
# so both pickup choices go as 2.
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


def _get(enrollment_id):
    enrollment = (
        OmsCourierEnrollment.all_objects.select_related("organization").filter(id=enrollment_id).first()
    )
    if enrollment is None:
        raise OmsCourierRequestError("Request not found.", 404)
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
        postex_client.create_pickup_address(
            connection.api_token,
            address=form["address"],
            city_name=form["city"],
            contact_person_name=form.get("contact_person_name") or form.get("shipper_name") or "",
            phone1=form["shipper_contact"],
            phone2=form.get("contact_1") or form["shipper_contact"],
            phone3=form.get("contact_2") or "",
            # PostEx's API has no shipper field; this is the free-text name it
            # keeps beside the contact person.
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


def approve_request(enrollment_id, *, message="", actor_email=""):
    """Approves a request. A PostEx one first becomes a pickup address on
    FynkTech's PostEx account (_create_postex_address) - if PostEx refuses
    it, the request stays pending and the reason comes back."""
    enrollment = _get(enrollment_id)
    message = (message or "").strip()[:500]
    if enrollment.courier == OmsCourierEnrollment.COURIER_POSTEX:
        enrollment.courier_reference = _create_postex_address(enrollment)
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
