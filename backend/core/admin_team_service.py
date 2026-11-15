"""Super admin side Admin Team: FynkTech staff logins with limited super
admin access, and the roles that say which super admin pages they get
(core.admin_pages). Only an owner super admin (a super admin login with no
AdminStaff row) manages these - see core.admin_views."""

import logging

from django.db import transaction

from . import admin_pages, supabase_admin
from .models import AdminRole, AdminStaff, Membership
from .rbac import write_audit_log
from .supabase_admin import SupabaseAdminError

logger = logging.getLogger(__name__)


class AdminTeamError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _log(action, summary, actor_user_id, actor_email, metadata=None):
    # No store owns these, so the store audit log skips them - the app log
    # keeps the record.
    logger.warning("%s by %s: %s %s", action, actor_email or actor_user_id, summary, metadata or "")
    try:
        write_audit_log(
            organization_id=None, action=action, summary=summary, actor_user_id=actor_user_id,
            actor_email=actor_email, entity_type="admin_team", metadata=metadata or {},
        )
    except Exception:  # noqa: BLE001 - the change itself went through
        pass


def _role_payload(role):
    return {
        "id": str(role.id),
        "name": role.name,
        "permissions": admin_pages.clean_permissions(role.permissions),
        "staff_count": getattr(role, "staff_count", None),
    }


def _staff_payload(staff):
    return {
        "user_id": str(staff.user_id),
        "email": staff.email,
        "name": staff.name,
        "role_id": str(staff.role_id) if staff.role_id else None,
        "role_name": staff.role.name if staff.role_id else "",
        # Own pages when no role is set.
        "page_permissions": admin_pages.clean_permissions(staff.page_permissions) if not staff.role_id else None,
        "access": staff.permissions(),
        "created_at": staff.created_at.isoformat(),
    }


def overview():
    from django.db.models import Count

    roles = AdminRole.objects.annotate(staff_count=Count("staff")).order_by("name")
    return {
        "pages": admin_pages.PAGES,
        "roles": [_role_payload(r) for r in roles],
        "staff": [_staff_payload(s) for s in AdminStaff.objects.select_related("role").order_by("created_at")],
    }


def _resolve_access(role_id, permissions):
    """(role, own permissions) - a role, or the login's own pages."""
    if role_id:
        role = AdminRole.objects.filter(id=role_id).first()
        if not role:
            raise AdminTeamError("Role not found", 404)
        return role, None
    own = admin_pages.clean_permissions(permissions)
    if not own:
        raise AdminTeamError("Pick a role, or give this login at least one page (Read or Read + Write).")
    return None, own


# ------------------------------------------------------------------ Roles --

def create_role(*, name, permissions, actor_user_id=None, actor_email=""):
    name = (name or "").strip()
    if not name:
        raise AdminTeamError("Role name is required")
    if AdminRole.objects.filter(name__iexact=name).exists():
        raise AdminTeamError("A role with this name already exists")
    perms = admin_pages.clean_permissions(permissions)
    if not perms:
        raise AdminTeamError("Give the role at least one page (Read or Read + Write)")
    role = AdminRole.objects.create(name=name, permissions=perms)
    _log("admin_team.role_create", f"Super admin role '{name}' created", actor_user_id, actor_email, {"permissions": perms})
    return _role_payload(role)


def update_role(role_id, *, name=None, permissions=None, actor_user_id=None, actor_email=""):
    role = AdminRole.objects.filter(id=role_id).first()
    if not role:
        raise AdminTeamError("Role not found", 404)
    if name is not None:
        name = name.strip()
        if not name:
            raise AdminTeamError("Role name is required")
        if AdminRole.objects.filter(name__iexact=name).exclude(id=role.id).exists():
            raise AdminTeamError("A role with this name already exists")
        role.name = name
    if permissions is not None:
        perms = admin_pages.clean_permissions(permissions)
        if not perms:
            raise AdminTeamError("Give the role at least one page (Read or Read + Write)")
        role.permissions = perms
    role.save()
    _log("admin_team.role_update", f"Super admin role '{role.name}' changed", actor_user_id, actor_email,
         {"permissions": role.permissions})
    return _role_payload(role)


def delete_role(role_id, *, actor_user_id=None, actor_email=""):
    role = AdminRole.objects.filter(id=role_id).first()
    if not role:
        raise AdminTeamError("Role not found", 404)
    if role.staff.exists():
        raise AdminTeamError("Logins still use this role - give them another role first.", 409)
    name = role.name
    role.delete()
    _log("admin_team.role_delete", f"Super admin role '{name}' deleted", actor_user_id, actor_email)
    return {"deleted": True}


# ------------------------------------------------------------------ Staff --

STAFF_APP_METADATA = {"role": "super_admin", "admin_staff": True, "organization_id": None, "modules": []}


@transaction.atomic
def create_staff(*, email, password, name="", role_id=None, permissions=None, actor_user_id=None, actor_email=""):
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise AdminTeamError("Enter a valid email")
    if len(password or "") < 8:
        raise AdminTeamError("Password must be at least 8 characters")
    role, own = _resolve_access(role_id, permissions)
    try:
        existing = supabase_admin.find_user_by_email(email)
    except SupabaseAdminError as exc:
        raise AdminTeamError(exc.message, exc.status_code) from exc
    if existing:
        # Never turn an existing login (a store's, or an owner) into staff.
        raise AdminTeamError("This email already has a login - use another email.", 409)
    try:
        user = supabase_admin.ensure_user(email=email, password=password, app_metadata=STAFF_APP_METADATA)
    except SupabaseAdminError as exc:
        raise AdminTeamError(exc.message, exc.status_code) from exc
    user_id = user.get("id")
    if not user_id:
        raise AdminTeamError("Supabase did not return a user id", 500)
    staff = AdminStaff.objects.create(
        user_id=user_id, email=email, name=(name or "").strip()[:150], role=role,
        page_permissions=own, created_by=actor_user_id,
    )
    _log("admin_team.staff_create", f"Super admin staff login {email} created", actor_user_id, actor_email,
         {"role": role.name if role else None, "permissions": own})
    return _staff_payload(staff)


def update_staff(user_id, *, name=None, role_id=None, permissions=None, set_access=False, password=None,
                 actor_user_id=None, actor_email=""):
    staff = AdminStaff.objects.select_related("role").filter(user_id=user_id).first()
    if not staff:
        raise AdminTeamError("Login not found", 404)
    if name is not None:
        staff.name = name.strip()[:150]
    if set_access:
        staff.role, staff.page_permissions = _resolve_access(role_id, permissions)
    if password:
        if len(password) < 8:
            raise AdminTeamError("Password must be at least 8 characters")
        try:
            supabase_admin.update_user(str(staff.user_id), password=password)
        except SupabaseAdminError as exc:
            raise AdminTeamError(exc.message, exc.status_code) from exc
    staff.save()
    _log("admin_team.staff_update", f"Super admin staff login {staff.email} changed", actor_user_id, actor_email,
         {"access": staff.permissions(), "password_reset": bool(password)})
    return _staff_payload(staff)


def remove_staff(user_id, *, actor_user_id=None, actor_email=""):
    staff = AdminStaff.objects.filter(user_id=user_id).first()
    if not staff:
        raise AdminTeamError("Login not found", 404)
    if str(staff.user_id) == str(actor_user_id):
        raise AdminTeamError("You can't remove yourself")
    email = staff.email
    staff.delete()
    # The login exists only for this; with the row gone the middleware
    # already refuses it (admin_staff claim, no row), so a failed delete
    # grants nothing.
    if not Membership.objects.filter(user_id=user_id).exists():
        try:
            supabase_admin.delete_user(str(user_id))
        except SupabaseAdminError:
            pass
    _log("admin_team.staff_remove", f"Super admin staff login {email} removed", actor_user_id, actor_email)
    return {"removed": True}
