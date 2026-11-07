"""Store roles (core.Role): made by the store admin, each a name and a
read/write level per page (core.pages). Staff logins get one role each
(team_service)."""

import logging

from . import pages, supabase_admin
from .models import Membership, Organization, Role
from .rbac import enabled_modules_for_org, write_audit_log
from .supabase_admin import SupabaseAdminError

logger = logging.getLogger(__name__)


class RoleError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def serialize_role(role, member_count=None):
    return {
        "id": role.id,
        "name": role.name,
        "permissions": role.permissions or {},
        "member_count": member_count if member_count is not None else role.memberships.count(),
    }


def page_catalog(organization_id):
    """The Roles editor's grid: every page, grouped by module, only for the
    modules this store has on."""
    enabled = enabled_modules_for_org(organization_id)
    out = []
    for module in pages.MODULES:
        items = [
            {"key": p["key"], "label": p["label"]}
            for p in pages.PAGES
            if p["module"] == module["key"] and pages.page_enabled(p["key"], enabled)
        ]
        if items:
            out.append({"key": module["key"], "label": module["label"], "pages": items})
    return out


def list_roles(organization_id):
    roles = Role.all_objects.filter(organization_id=organization_id).order_by("name")
    counts = {}
    for role_id in Membership.objects.filter(
        organization_id=organization_id, role_ref__isnull=False
    ).values_list("role_ref_id", flat=True):
        counts[role_id] = counts.get(role_id, 0) + 1
    return {
        "roles": [serialize_role(r, counts.get(r.id, 0)) for r in roles],
        "pages": page_catalog(organization_id),
        "levels": list(pages.LEVELS),
    }


def _clean_name(name):
    name = " ".join(str(name or "").split())
    if not name:
        raise RoleError("Role name is required")
    if len(name) > 80:
        raise RoleError("Role name is too long (80 characters at most)")
    return name


def _clean_permissions(organization_id, raw):
    permissions = pages.clean_permissions(raw)
    enabled = enabled_modules_for_org(organization_id)
    permissions = {k: v for k, v in permissions.items() if pages.page_enabled(k, enabled)}
    if not permissions:
        raise RoleError("Give the role at least one page (Read or Read + Write)")
    return permissions


def get_role(organization_id, role_id):
    role = Role.all_objects.filter(organization_id=organization_id, id=role_id).first()
    if role is None:
        raise RoleError("Role not found", 404)
    return role


def create_role(*, organization_id, name, permissions, actor_user_id=None, actor_email=""):
    name = _clean_name(name)
    if Role.all_objects.filter(organization_id=organization_id, name__iexact=name).exists():
        raise RoleError(f"A role named '{name}' already exists")
    role = Role.all_objects.create(
        organization_id=organization_id,
        name=name,
        permissions=_clean_permissions(organization_id, permissions),
    )
    write_audit_log(
        organization_id=organization_id,
        action="role.create",
        summary=f"Created role {role.name}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="role",
        entity_id=str(role.id),
        metadata={"name": role.name, "permissions": role.permissions},
    )
    return serialize_role(role, 0)


def update_role(*, organization_id, role_id, name=None, permissions=None, actor_user_id=None, actor_email=""):
    role = get_role(organization_id, role_id)
    fields = []
    if name is not None:
        name = _clean_name(name)
        if (
            Role.all_objects.filter(organization_id=organization_id, name__iexact=name)
            .exclude(id=role.id)
            .exists()
        ):
            raise RoleError(f"A role named '{name}' already exists")
        role.name = name
        fields.append("name")
    if permissions is not None:
        role.permissions = _clean_permissions(organization_id, permissions)
        fields.append("permissions")
    if not fields:
        raise RoleError("Nothing to update")
    role.save(update_fields=[*fields, "updated_at"])
    if "permissions" in fields:
        sync_role_members(role)
    write_audit_log(
        organization_id=organization_id,
        action="role.update",
        summary=f"Updated role {role.name}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="role",
        entity_id=str(role.id),
        metadata={"name": role.name, "permissions": role.permissions},
    )
    return serialize_role(role)


def delete_role(*, organization_id, role_id, actor_user_id=None, actor_email=""):
    role = get_role(organization_id, role_id)
    in_use = role.memberships.count()
    if in_use:
        raise RoleError(
            f"{in_use} login{'s use' if in_use != 1 else ' uses'} this role - give "
            f"{'them' if in_use != 1 else 'it'} another role first"
        )
    name = role.name
    role_pk = role.id
    role.delete()
    write_audit_log(
        organization_id=organization_id,
        action="role.delete",
        summary=f"Deleted role {name}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="role",
        entity_id=str(role_pk),
        metadata={"name": name},
    )
    return {"success": True}


def modules_for_role(role):
    """The store modules (header tabs) a role opens right now."""
    enabled = enabled_modules_for_org(role.organization_id)
    return pages.modules_for(pages.effective_permissions(role.permissions, enabled))


def sync_role_members(role):
    """After a role changes: its logins' module list (kept for the login
    token) follows. Page access itself is read live on every request."""
    modules = modules_for_role(role)
    organization = Organization.objects.filter(id=role.organization_id).first()
    for membership in role.memberships.all():
        if list(membership.allowed_modules or []) != modules:
            membership.allowed_modules = modules
            membership.save(update_fields=["allowed_modules"])
        if organization is None:
            continue
        try:
            supabase_admin.set_org_claims(str(membership.user_id), organization, "org_user", modules=modules)
        except SupabaseAdminError:
            logger.warning("role %s: could not refresh login claims for %s", role.id, membership.user_id)
