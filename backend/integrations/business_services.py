"""Business-API logic for the super admin console.

Views stay thin and this holds the behaviour, matching
core/organization_admin_service.py's shape (including its
raise-a-typed-error-with-a-status-code convention).
"""

import logging

from django.core.exceptions import ValidationError
from django.core.validators import validate_slug
from django.db import IntegrityError
from django.utils import timezone

from .models import SmartlaneBusinessConfig, SmartlaneCourierOffering
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
        "registered_ip": config.registered_ip,
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
    if "registered_ip" in body:
        config.registered_ip = (body.get("registered_ip") or "").strip()
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
            "Set the JWT token first - get it from Smartlane's business portal."
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
    """Hard delete. Deactivating is the safer everyday action and is what the
    UI leads with - once orgs can request offerings (next phase) this will
    need a guard against deleting one that is already in use."""
    offering = _get_offering(offering_id)
    offering.delete()
