"""The store side of OMS Courier: which couriers a store asks FynkTech to
ship its orders with (through FynkTech's own accounts - see core.
platform_service), and the shipper details for each. Each one is a request
the super admin approves or rejects (integrations.oms_courier_service); the
Dispatch Hub only books a store's orders with an approved courier
(oms/views.py's bulk_action)."""

import re

from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Organization
from core.permissions import IsOrgAdmin
from core.rbac import write_audit_log

from .models import OmsCourierEnrollment

COURIERS = dict(OmsCourierEnrollment.COURIER_CHOICES)
# Field -> (label, max length). All required while a courier is on.
DETAIL_FIELDS = {
    "store_name": ("Store name", 255),
    "phone": ("Phone number", 50),
    "pickup_address": ("Pickup address", 500),
}

# PostEx is asked for with its own "Add Address" form, which becomes a
# pickup address on FynkTech's PostEx account when approved (see
# oms_courier_service.approve_request). Field -> (label, max length,
# required, kind). PostEx assigns the address code itself.
POSTEX_ADDRESS_TYPES = {
    "return": "Return Address",
    "pickup": "Pickup Address",
    "pickup_return": "Pickup/Return Address",
}
POSTEX_FIELDS = {
    "city": ("City", 150, True, "text"),
    "address_type": ("Address type", 20, True, "address_type"),
    "shipper_name": ("Shipper name", 255, True, "text"),
    "shipper_contact": ("Shipper contact", 11, True, "phone"),
    "contact_person_name": ("Contact person name", 255, True, "text"),
    "contact_1": ("Contact#1", 11, False, "phone"),
    "contact_2": ("Contact#2", 11, False, "phone"),
    "address": ("Address", 500, True, "text"),
}


def _mobile(value):
    """"+92 300 1234567" / "923001234567" / "3001234567" -> "03001234567",
    or "" if it isn't a Pakistani mobile number - the shape PostEx takes."""
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("0092"):
        digits = digits[4:]
    elif digits.startswith("92") and len(digits) == 12:
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("3"):
        digits = f"0{digits}"
    return digits if re.fullmatch(r"03\d{9}", digits) else ""


def _clean_postex(body):
    """(details, generic fields, error) from a PostEx address form."""
    details = {}
    problems = []
    for field, (label, limit, required, kind) in POSTEX_FIELDS.items():
        value = str(body.get(field) or "").strip()
        if not value:
            if required:
                problems.append(f"{label} is required.")
            details[field] = ""
            continue
        if kind == "phone":
            value = _mobile(value)
            if not value:
                problems.append(f"{label} must be a mobile number like 03001234567.")
        elif kind == "address_type" and value not in POSTEX_ADDRESS_TYPES:
            problems.append(f"Pick an {label.lower()} from the list.")
        elif len(value) > limit:
            problems.append(f"{label} can be at most {limit} characters.")
        details[field] = value
    if problems:
        return None, None, " ".join(problems)
    generic = {
        "store_name": details["shipper_name"][:255],
        "phone": details["shipper_contact"],
        "pickup_address": f"{details['address']}, {details['city']}"[:500],
    }
    return details, generic, ""


def _clean_generic(body):
    """(details, generic fields, error) from the generic three-field form."""
    generic = {field: str(body.get(field) or "").strip() for field in DETAIL_FIELDS}
    missing = [label for field, (label, _) in DETAIL_FIELDS.items() if not generic[field]]
    if missing:
        return None, None, f"{', '.join(missing)} required."
    too_long = [
        f"{label} (max {limit} characters)"
        for field, (label, limit) in DETAIL_FIELDS.items()
        if len(generic[field]) > limit
    ]
    if too_long:
        return None, None, f"Too long: {', '.join(too_long)}."
    return {}, generic, ""


def serialize_enrollment(enrollment):
    return {
        "courier": enrollment.courier,
        "is_enabled": enrollment.is_enabled,
        "status": enrollment.status,
        "store_name": enrollment.store_name,
        "phone": enrollment.phone,
        "pickup_address": enrollment.pickup_address,
        "details": enrollment.details or {},
        "courier_reference": enrollment.courier_reference,
        "review_note": enrollment.review_note,
        "requested_at": enrollment.requested_at.isoformat() if enrollment.requested_at else None,
        "reviewed_at": enrollment.reviewed_at.isoformat() if enrollment.reviewed_at else None,
        "updated_at": enrollment.updated_at.isoformat(),
    }


def mark_requested(enrollment):
    """Back into the super admin's queue, with the old answer cleared."""
    enrollment.status = OmsCourierEnrollment.STATUS_PENDING
    enrollment.requested_at = timezone.now()
    enrollment.review_note = ""
    enrollment.reviewed_by_email = ""
    enrollment.reviewed_at = None


class OmsCourierEnrollmentListView(APIView):
    """GET -> every courier the store has asked for, plus the store's own
    name to prefill a first form with."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        enrollments = OmsCourierEnrollment.objects.filter(organization_id=request.organization_id)
        org = Organization.objects.filter(id=request.organization_id).first()
        return Response(
            {
                "success": True,
                "couriers": [serialize_enrollment(e) for e in enrollments],
                "defaults": {"store_name": org.name if org else ""},
            }
        )


class OmsCourierEnrollmentOptionsView(APIView):
    """GET -> what a courier's request form picks from. PostEx: its cities
    (from FynkTech's own PostEx account) and address types."""

    permission_classes = [IsOrgAdmin]

    def get(self, request, courier):
        if courier != OmsCourierEnrollment.COURIER_POSTEX:
            return Response({"success": True})

        from .postex import services as postex_services
        from .postex.exceptions import PostExAPIError

        connection = postex_services.platform_connection()
        cities = []
        if connection is not None:
            try:
                cities = postex_services.get_cities(connection)
            except PostExAPIError as exc:
                return Response(
                    {"success": False, "error": f"Could not load PostEx cities: {exc}"},
                    status=http_status.HTTP_502_BAD_GATEWAY,
                )
        return Response(
            {
                "success": True,
                "cities": cities,
                "address_types": [
                    {"value": key, "label": label} for key, label in POSTEX_ADDRESS_TYPES.items()
                ],
            }
        )


class OmsCourierEnrollmentDetailView(APIView):
    """PUT {is_enabled, ...form fields} asks for one courier (or updates the
    request, or turns it off) - PostEx with its address form
    (POSTEX_FIELDS), the rest with store_name/phone/pickup_address. Turning
    on with new details, or after a rejection, is a fresh request; turning
    an approved courier back on unchanged keeps its approval."""

    permission_classes = [IsOrgAdmin]

    def put(self, request, courier):
        if courier not in COURIERS:
            return Response(
                {"success": False, "error": f"Unknown courier {courier!r}."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        body = request.data or {}
        is_enabled = bool(body.get("is_enabled", True))
        existing = OmsCourierEnrollment.objects.filter(
            organization_id=request.organization_id, courier=courier
        ).first()

        details, generic = {}, {}
        if is_enabled:
            clean = _clean_postex if courier == OmsCourierEnrollment.COURIER_POSTEX else _clean_generic
            details, generic, problem = clean(body)
            if problem:
                return Response(
                    {"success": False, "error": problem}, status=http_status.HTTP_400_BAD_REQUEST
                )
        elif existing is None:
            return Response(
                {"success": False, "error": f"{COURIERS[courier]} isn't on."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if existing is None:
            enrollment = OmsCourierEnrollment(
                organization_id=request.organization_id, courier=courier, is_enabled=True,
                details=details, **generic,
            )
            mark_requested(enrollment)
            try:
                enrollment.save()
            except IntegrityError:
                # A double-submit raced the first one - it's already there.
                enrollment = OmsCourierEnrollment.objects.get(
                    organization_id=request.organization_id, courier=courier
                )
        else:
            enrollment = existing
            enrollment.is_enabled = is_enabled
            # Turning a courier off keeps its details and approval, so
            # turning it back on starts from them.
            if is_enabled:
                changed = (enrollment.details or {}) != details or any(
                    getattr(enrollment, f) != v for f, v in generic.items()
                )
                for field, value in generic.items():
                    setattr(enrollment, field, value)
                enrollment.details = details
                if changed or enrollment.status != OmsCourierEnrollment.STATUS_APPROVED:
                    mark_requested(enrollment)
            enrollment.save()

        if not enrollment.is_enabled:
            action, verb = "oms_courier.disabled", "Turned off"
        elif enrollment.status == OmsCourierEnrollment.STATUS_PENDING:
            action, verb = "oms_courier.requested", "Requested"
        else:
            action, verb = "oms_courier.enabled", "Turned back on"
        write_audit_log(
            organization_id=request.organization_id,
            action=action,
            summary=f"{verb} {COURIERS[courier]} through OMS Courier",
            actor_user_id=request.user_id,
            entity_type="oms_courier_enrollment",
            entity_id=str(enrollment.id),
        )
        return Response({"success": True, "courier": serialize_enrollment(enrollment)})
