"""The Dispatch Hub roster - which stores a super admin has pulled in to
operate together (see middleware.py's X-Dispatch-Hub handling) and what
FynkTech bills each one per dispatched order."""

from .models import DispatchHubStore, Organization
from .rbac import write_audit_log


class DispatchHubError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def active_hub_organization_ids():
    """Org ids currently operable from the Hub - in the roster AND not
    suspended. Read by TenantMiddleware (HTTP) and core.consumers
    (WebSocket) alike, so a store leaving the Hub or getting suspended
    takes effect on both the same way a plain "Open store" exit does."""
    return list(
        DispatchHubStore.objects.filter(organization__is_active=True).values_list(
            "organization_id", flat=True
        )
    )


def _bank_details_summary(organization_id):
    from finance.models import BankDetails

    details = BankDetails.all_objects.filter(organization_id=organization_id).first()
    if not details:
        return None
    return {"account_title": details.account_title, "bank_name": details.bank_name}


def _oms_courier_connected(organization_id):
    from integrations.models import SmartlaneConnection

    return SmartlaneConnection.all_objects.filter(
        organization_id=organization_id, kind=SmartlaneConnection.KIND_OMS, is_connected=True
    ).exists()


def list_hub_stores():
    entries = DispatchHubStore.objects.select_related("organization").all()
    return [
        {
            "id": str(entry.organization_id),
            "name": entry.organization.name,
            "slug": entry.organization.slug,
            "is_active": entry.organization.is_active,
            "per_order_rate": str(entry.per_order_rate),
            "added_at": entry.added_at.isoformat(),
            "bank_details": _bank_details_summary(entry.organization_id),
            "oms_courier_connected": _oms_courier_connected(entry.organization_id),
        }
        for entry in entries
    ]


def add_to_hub(organization_id, *, per_order_rate=0, actor_user_id=None):
    try:
        organization = Organization.objects.get(id=organization_id)
    except Organization.DoesNotExist as exc:
        raise DispatchHubError("Store not found", 404) from exc

    entry, created = DispatchHubStore.objects.update_or_create(
        organization=organization,
        defaults={"per_order_rate": per_order_rate or 0, "added_by": actor_user_id},
    )
    write_audit_log(
        organization_id=organization.id,
        action="dispatch_hub_added" if created else "dispatch_hub_rate_updated",
        summary=f"{'Added to' if created else 'Updated in'} the Dispatch Hub"
        f" (rate: {entry.per_order_rate})",
        actor_user_id=actor_user_id,
    )
    return entry


def update_rate(organization_id, per_order_rate):
    try:
        entry = DispatchHubStore.objects.get(organization_id=organization_id)
    except DispatchHubStore.DoesNotExist as exc:
        raise DispatchHubError("That store isn't in the Dispatch Hub", 404) from exc
    entry.per_order_rate = per_order_rate or 0
    entry.save(update_fields=["per_order_rate"])
    return entry


def remove_from_hub(organization_id, *, actor_user_id=None):
    deleted, _ = DispatchHubStore.objects.filter(organization_id=organization_id).delete()
    if deleted:
        write_audit_log(
            organization_id=organization_id,
            action="dispatch_hub_removed",
            summary="Removed from the Dispatch Hub",
            actor_user_id=actor_user_id,
        )
    return bool(deleted)
