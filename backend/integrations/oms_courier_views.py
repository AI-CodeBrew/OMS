"""The store side of OMS Courier: which couriers a store asks FynkTech to
ship its orders with (through FynkTech's own accounts - see core.
platform_service), and the shipper details for each. Each one is a request
the super admin approves or rejects (integrations.oms_courier_service); the
Dispatch Hub only books a store's orders with an approved courier
(oms/views.py's bulk_action)."""

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


def serialize_enrollment(enrollment):
    return {
        "courier": enrollment.courier,
        "is_enabled": enrollment.is_enabled,
        "status": enrollment.status,
        "store_name": enrollment.store_name,
        "phone": enrollment.phone,
        "pickup_address": enrollment.pickup_address,
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


class OmsCourierEnrollmentDetailView(APIView):
    """PUT {is_enabled, store_name, phone, pickup_address} asks for one
    courier (or updates the request, or turns it off). Turning on with new
    details, or after a rejection, is a fresh request; turning an approved
    courier back on unchanged keeps its approval."""

    permission_classes = [IsOrgAdmin]

    def put(self, request, courier):
        if courier not in COURIERS:
            return Response(
                {"success": False, "error": f"Unknown courier {courier!r}."},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        body = request.data or {}
        is_enabled = bool(body.get("is_enabled", True))
        details = {field: str(body.get(field) or "").strip() for field in DETAIL_FIELDS}
        existing = OmsCourierEnrollment.objects.filter(
            organization_id=request.organization_id, courier=courier
        ).first()

        if is_enabled:
            missing = [label for field, (label, _) in DETAIL_FIELDS.items() if not details[field]]
            if missing:
                return Response(
                    {"success": False, "error": f"{', '.join(missing)} required."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            too_long = [
                f"{label} (max {limit} characters)"
                for field, (label, limit) in DETAIL_FIELDS.items()
                if len(details[field]) > limit
            ]
            if too_long:
                return Response(
                    {"success": False, "error": f"Too long: {', '.join(too_long)}."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
        elif existing is None:
            return Response(
                {"success": False, "error": f"{COURIERS[courier]} isn't on."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if existing is None:
            enrollment = OmsCourierEnrollment(
                organization_id=request.organization_id, courier=courier, is_enabled=True, **details
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
                changed = any(getattr(enrollment, f) != v for f, v in details.items())
                for field, value in details.items():
                    setattr(enrollment, field, value)
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
