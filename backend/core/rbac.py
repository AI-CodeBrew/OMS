"""Helpers for org RBAC claims and audit logging."""

from .models import Organization, OrganizationAuditLog, OrganizationModule


STAFF_MODULES = ("oms", "wms", "finance")


def enabled_modules_for_org(organization_id):
    return list(
        OrganizationModule.objects.filter(
            organization_id=organization_id, is_enabled=True
        ).values_list("module", flat=True)
    )


def resolve_modules_for_membership(*, role, allowed_modules, organization_id):
    enabled = enabled_modules_for_org(organization_id)
    if role == "org_admin":
        return enabled
    # Preserve request order but only keep valid, enabled staff modules.
    seen = set()
    modules = []
    for m in allowed_modules or []:
        if m in STAFF_MODULES and m in enabled and m not in seen:
            seen.add(m)
            modules.append(m)
    return modules


def build_org_app_metadata(organization, *, role, modules):
    return {
        "organization_id": str(organization.id),
        "organization_name": organization.name,
        "role": role,
        "modules": list(modules or []),
    }


def write_audit_log(
    *,
    organization_id,
    action,
    summary,
    actor_user_id=None,
    actor_email="",
    entity_type="",
    entity_id="",
    metadata=None,
):
    if not organization_id:
        return None
    return OrganizationAuditLog.objects.create(
        organization_id=organization_id,
        actor_user_id=actor_user_id or None,
        actor_email=(actor_email or "")[:255],
        action=action,
        entity_type=(entity_type or "")[:64],
        entity_id=str(entity_id or "")[:64],
        summary=(summary or "")[:500],
        metadata=metadata or {},
    )


def org_from_id(organization_id):
    return Organization.objects.filter(id=organization_id).first()
