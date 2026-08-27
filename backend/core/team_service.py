import re
from datetime import datetime

from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.utils.text import slugify

from . import supabase_admin
from .models import Membership, Organization
from .rbac import (
    STAFF_MODULES,
    enabled_modules_for_org,
    resolve_modules_for_membership,
    write_audit_log,
)
from .supabase_admin import SupabaseAdminError

# Local-part only: john, sales.desk, ali_01 — never includes @
_USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")


class TeamAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def staff_email_domain(organization):
    """Fixed login domain per org, e.g. fynktech.com from slug/name."""
    slug = (organization.slug or "").strip().lower()
    if not slug:
        slug = slugify(organization.name or "") or "org"
    return f"{slug}.com"


def normalize_staff_username(username):
    username = (username or "").strip().lower()
    if "@" in username:
        username = username.split("@", 1)[0].strip()
    if not username:
        raise TeamAdminError("Username is required")
    if not _USERNAME_RE.match(username):
        raise TeamAdminError(
            "Username may only use letters, numbers, dots, underscores, and hyphens"
        )
    return username


def build_staff_email(organization, username):
    local = normalize_staff_username(username)
    return f"{local}@{staff_email_domain(organization)}"


def _parse_bound(value):
    if not value:
        return None
    dt = parse_datetime(value)
    if dt is None:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _coerce_modules(modules=None, module=None):
    """Accept modules=[...] and/or legacy module=\"oms\"."""
    items = []
    if modules is not None:
        if isinstance(modules, str):
            items = [modules]
        elif isinstance(modules, (list, tuple)):
            items = list(modules)
        else:
            raise TeamAdminError("modules must be a list")
    elif module is not None:
        items = [module]
    return [str(m).strip() for m in items if m and str(m).strip()]


def _serialize_member(membership, email=None):
    local = ""
    if email and "@" in email:
        local = email.split("@", 1)[0]
    return {
        "user_id": str(membership.user_id),
        "email": email,
        "username": local,
        "role": membership.role,
        "allowed_modules": list(membership.allowed_modules or []),
        "created_at": membership.created_at.isoformat(),
    }


def list_team(organization_id):
    """Staff only — org admins are not listed in the team table."""
    organization = Organization.objects.filter(id=organization_id).first()
    memberships = (
        Membership.objects.filter(organization_id=organization_id, role="org_user")
        .order_by("created_at")
    )
    from .organization_admin_service import _emails_for_user_ids

    email_map = _emails_for_user_ids([m.user_id for m in memberships])
    return {
        "email_domain": staff_email_domain(organization) if organization else "",
        "members": [
            _serialize_member(m, email_map.get(str(m.user_id))) for m in memberships
        ],
    }


def invite_team_member(
    *,
    organization_id,
    username=None,
    email=None,
    password,
    modules=None,
    module=None,
    actor_user_id=None,
    actor_email="",
):
    password = password or ""
    if len(password) < 8:
        raise TeamAdminError("Password must be at least 8 characters")

    organization = Organization.objects.filter(id=organization_id).first()
    if not organization:
        raise TeamAdminError("Organization not found", 404)

    # Prefer username; fall back to local-part of a full email if provided.
    local = username if username is not None else email
    email = build_staff_email(organization, local)

    requested = _coerce_modules(modules=modules, module=module)
    if not requested:
        raise TeamAdminError("Select at least one module (OMS, WMS, or Financify)")
    for m in requested:
        if m not in STAFF_MODULES:
            raise TeamAdminError("Modules must be oms, wms, and/or finance")

    enabled = enabled_modules_for_org(organization_id)
    for m in requested:
        if m not in enabled:
            raise TeamAdminError(f"Module '{m}' is not enabled for this organization")

    resolved = resolve_modules_for_membership(
        role="org_user",
        allowed_modules=requested,
        organization_id=organization_id,
    )
    if not resolved:
        raise TeamAdminError("Could not assign modules")

    try:
        existing = supabase_admin.find_user_by_email(email)
    except SupabaseAdminError as exc:
        raise TeamAdminError(exc.message, exc.status_code) from exc

    if existing:
        existing_id = existing.get("id")
        if Membership.objects.filter(organization_id=organization_id, user_id=existing_id).exists():
            raise TeamAdminError("This user is already a member of the organization")
        if Membership.objects.filter(user_id=existing_id).exists():
            raise TeamAdminError("This login already belongs to another organization", 409)

    try:
        user = supabase_admin.ensure_user(
            email=email,
            password=password,
            app_metadata={
                "organization_id": str(organization.id),
                "organization_name": organization.name,
                "role": "org_user",
                "modules": resolved,
            },
        )
    except SupabaseAdminError as exc:
        raise TeamAdminError(exc.message, exc.status_code) from exc

    user_id = user.get("id")
    if not user_id:
        raise TeamAdminError("Supabase did not return a user id", 500)

    if Membership.objects.filter(organization_id=organization_id, user_id=user_id).exists():
        raise TeamAdminError("This user is already a member of the organization")

    other = Membership.objects.filter(user_id=user_id).exclude(organization_id=organization_id).first()
    if other:
        raise TeamAdminError("This login already belongs to another organization", 409)

    membership = Membership.objects.create(
        organization=organization,
        user_id=user_id,
        role="org_user",
        allowed_modules=resolved,
    )

    try:
        supabase_admin.set_org_claims(user_id, organization, "org_user", modules=resolved)
    except SupabaseAdminError as exc:
        raise TeamAdminError(exc.message, exc.status_code) from exc

    write_audit_log(
        organization_id=organization_id,
        action="team.invite",
        summary=f"Invited {email} with modules {', '.join(resolved)}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="membership",
        entity_id=str(membership.id),
        metadata={"email": email, "modules": resolved, "role": "org_user"},
    )
    return _serialize_member(membership, email=email)


def update_team_member(
    *,
    organization_id,
    user_id,
    modules=None,
    module=None,
    username=None,
    email=None,
    password=None,
    actor_user_id=None,
    actor_email="",
):
    membership = (
        Membership.objects.select_related("organization")
        .filter(organization_id=organization_id, user_id=user_id, role="org_user")
        .first()
    )
    if not membership:
        raise TeamAdminError("Member not found", 404)

    organization = membership.organization
    resolved = list(membership.allowed_modules or [])
    modules_provided = modules is not None or module is not None
    if modules_provided:
        requested = _coerce_modules(modules=modules, module=module)
        if not requested:
            raise TeamAdminError("Select at least one module (OMS, WMS, or Financify)")
        for m in requested:
            if m not in STAFF_MODULES:
                raise TeamAdminError("Modules must be oms, wms, and/or finance")
        enabled = enabled_modules_for_org(organization_id)
        for m in requested:
            if m not in enabled:
                raise TeamAdminError(f"Module '{m}' is not enabled for this organization")
        resolved = resolve_modules_for_membership(
            role="org_user",
            allowed_modules=requested,
            organization_id=organization_id,
        )
        if not resolved:
            raise TeamAdminError("Could not assign modules")
        membership.allowed_modules = resolved
        membership.save(update_fields=["allowed_modules"])

    new_email = None
    if username is not None or email is not None:
        local = username if username is not None else email
        new_email = build_staff_email(organization, local)

    if password is not None and password != "" and len(password) < 8:
        raise TeamAdminError("Password must be at least 8 characters")

    if new_email is None and not password and not modules_provided:
        raise TeamAdminError("Provide modules, username, and/or password to update")

    try:
        update_kwargs = {}
        if new_email is not None:
            update_kwargs["email"] = new_email
        if password:
            update_kwargs["password"] = password
        if update_kwargs:
            supabase_admin.update_user(str(user_id), **update_kwargs)
        supabase_admin.set_org_claims(
            str(user_id), organization, "org_user", modules=resolved
        )
    except SupabaseAdminError as exc:
        raise TeamAdminError(exc.message, exc.status_code) from exc

    write_audit_log(
        organization_id=organization_id,
        action="team.update",
        summary=f"Updated team member {user_id} modules={resolved}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="membership",
        entity_id=str(membership.id),
        metadata={
            "user_id": str(user_id),
            "modules": resolved,
            "email_changed": bool(new_email),
            "password_reset": bool(password),
        },
    )

    from .organization_admin_service import _emails_for_user_ids

    email_map = _emails_for_user_ids([membership.user_id])
    display_email = new_email or email_map.get(str(membership.user_id))
    return _serialize_member(membership, display_email)


def remove_team_member(
    *,
    organization_id,
    user_id,
    actor_user_id=None,
    actor_email="",
):
    membership = Membership.objects.filter(
        organization_id=organization_id, user_id=user_id, role="org_user"
    ).first()
    if not membership:
        raise TeamAdminError("Member not found", 404)
    if str(actor_user_id) == str(user_id):
        raise TeamAdminError("Cannot remove yourself")

    membership_id = str(membership.id)
    membership.delete()

    try:
        supabase_admin.update_user(
            str(user_id),
            app_metadata={
                "organization_id": None,
                "organization_name": None,
                "role": "org_user",
                "modules": [],
            },
        )
    except SupabaseAdminError:
        pass

    write_audit_log(
        organization_id=organization_id,
        action="team.remove",
        summary=f"Removed team member {user_id}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="membership",
        entity_id=membership_id,
        metadata={"user_id": str(user_id)},
    )
    return {"success": True}


def list_audit_logs(*, organization_id, date_from=None, date_to=None, page=1, page_size=50):
    from .models import OrganizationAuditLog

    qs = OrganizationAuditLog.objects.filter(organization_id=organization_id)
    dt_from = _parse_bound(date_from)
    if dt_from:
        qs = qs.filter(created_at__gte=dt_from)
    dt_to = _parse_bound(date_to)
    if dt_to:
        qs = qs.filter(created_at__lte=dt_to)

    page = max(1, int(page or 1))
    page_size = min(100, max(1, int(page_size or 50)))
    total = qs.count()
    start = (page - 1) * page_size
    rows = qs[start : start + page_size]
    return {
        "count": total,
        "page": page,
        "page_size": page_size,
        "results": [
            {
                "id": str(r.id),
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "actor_email": r.actor_email,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "summary": r.summary,
                "metadata": r.metadata or {},
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }
