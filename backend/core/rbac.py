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
        "is_manual_store": organization.is_manual_store,
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
    from .activity_log_service import category_for
    from .context import current_request_meta

    # Inside a request, fill in whoever made it and where from - most call
    # sites only pass what they know (often no email, never an IP) - and
    # tell TenantMiddleware this request already has its log row.
    request_meta = current_request_meta.get() or {}
    if request_meta:
        request_meta["audited"] = True
        if not actor_email and actor_user_id in (None, "", request_meta.get("user_id")):
            actor_email = request_meta.get("email") or ""
        actor_user_id = actor_user_id or request_meta.get("user_id")
    path = request_meta.get("path", "")
    return OrganizationAuditLog.objects.create(
        organization_id=organization_id,
        actor_user_id=actor_user_id or None,
        actor_email=(actor_email or "")[:255],
        actor_role=request_meta.get("role") or OrganizationAuditLog.ROLE_SYSTEM,
        action=action,
        category=category_for(action, path),
        entity_type=(entity_type or "")[:64],
        entity_id=str(entity_id or "")[:64],
        summary=(summary or "")[:500],
        metadata=metadata or {},
        ip_address=request_meta.get("ip", "")[:64],
        user_agent=request_meta.get("user_agent", "")[:300],
        request_method=request_meta.get("method", "")[:8],
        request_path=path[:255],
    )


def org_from_id(organization_id):
    return Organization.objects.filter(id=organization_id).first()
