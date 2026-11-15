import re

from django.utils.text import slugify

from . import supabase_admin
from .models import Membership, Organization
from .rbac import (
    RETURNS_ASSOCIATE,
    STAFF_MODULES,
    enabled_modules_for_org,
    org_module_for,
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


def _validate_requested_modules(requested, organization_id):
    if not requested:
        raise TeamAdminError(
            "Select at least one module (OMS, WMS, Financify, or Returns Associate)"
        )
    for m in requested:
        if m not in STAFF_MODULES:
            raise TeamAdminError("Modules must be oms, wms, finance, and/or returns")
    if RETURNS_ASSOCIATE in requested and len(set(requested)) > 1:
        raise TeamAdminError("Returns Associate cannot be combined with other modules")
    enabled = enabled_modules_for_org(organization_id)
    for m in requested:
        if org_module_for(m) not in enabled:
            raise TeamAdminError(
                f"Module '{org_module_for(m)}' is not enabled for this organization"
            )


def _check_manageable(modules, limit_to_modules):
    """limit_to_modules=None: no limit (org admin). Otherwise every module
    must be in it - WMS staff pass ("returns",) to manage only Returns
    Associates."""
    if limit_to_modules is None:
        return
    if not modules or any(m not in limit_to_modules for m in modules):
        raise TeamAdminError("You can only manage Returns Associate logins", 403)


def _serialize_member(membership, email=None):
    local = ""
    if email and "@" in email:
        local = email.split("@", 1)[0]
    own = membership.page_permissions
    return {
        "user_id": str(membership.user_id),
        "email": email,
        "username": local,
        "role": membership.role,
        # The pages this login can open (Team form's access picker).
        "page_permissions": own,
        "access": own,
        "allowed_modules": list(membership.allowed_modules or []),
        "created_at": membership.created_at.isoformat(),
    }


def _own_pages(organization_id, raw):
    """The pages picked for one login on the Team form - (pages, modules)."""
    from . import pages

    granted = pages.effective_permissions(
        pages.clean_permissions(raw), enabled_modules_for_org(organization_id)
    )
    if not granted:
        raise TeamAdminError("Give this login at least one page (Read or Read + Write)")
    return granted, pages.modules_for(granted)





def list_team(organization_id, limit_to_modules=None):
    """Staff only — org admins are not listed in the team table."""
    organization = Organization.objects.filter(id=organization_id).first()
    memberships = (
        Membership.objects.filter(organization_id=organization_id, role="org_user")
        .order_by("created_at")
    )
    if limit_to_modules is not None:
        memberships = [
            m for m in memberships
            if m.allowed_modules and all(x in limit_to_modules for x in m.allowed_modules)
        ]
    from .organization_admin_service import _emails_for_user_ids

    email_map = _emails_for_user_ids([m.user_id for m in memberships])
    from . import pages

    # An organization with several stores (core.org_group): which of its
    # stores each login can open - the Team page's Store access.
    from . import org_group

    group = org_group.group_stores(organization_id)
    access = {}
    if len(group) > 1:
        for user_id, store_id in Membership.objects.filter(
            user_id__in=[m.user_id for m in memberships], organization_id__in=[g["id"] for g in group]
        ).values_list("user_id", "organization_id"):
            access.setdefault(str(user_id), []).append(str(store_id))

    def serialize(m):
        row = _serialize_member(m, email_map.get(str(m.user_id)))
        if len(group) > 1:
            row["store_ids"] = access.get(str(m.user_id), [str(organization_id)])
        return row

    return {
        "email_domain": staff_email_domain(organization) if organization else "",
        # The access picker's grid - this store's modules and their pages.
        "pages": pages.page_catalog(enabled_modules_for_org(organization_id)),
        "group_stores": (
            [{**g, "is_current": g["id"] == str(organization_id)} for g in group] if len(group) > 1 else []
        ),
        "members": [serialize(m) for m in memberships],
    }


def set_store_access(
    *, organization_id, user_id, store_ids, actor_user_id=None, actor_email="", limit_to_modules=None
):
    """Which stores of the organization a staff login can open (Team page).
    Each store it gains gets a Membership with the same pages as here -
    trimmed to what that store has enabled; roles stay per store. Each
    store it loses has its Membership removed. This store itself can't be
    taken away here (Remove does that), and only stores the person making
    the change can open themselves are touched."""
    from . import org_group, pages

    membership = Membership.objects.filter(
        organization_id=organization_id, user_id=user_id, role="org_user"
    ).first()
    if not membership:
        raise TeamAdminError("Member not found", 404)
    _check_manageable(membership.allowed_modules, limit_to_modules)

    group = {g["id"]: g["name"] for g in org_group.group_stores(organization_id)}
    if len(group) < 2:
        raise TeamAdminError("This store isn't part of an organization with other stores.")
    wanted = {str(s) for s in (store_ids or [])} | {str(organization_id)}
    unknown = wanted - set(group)
    if unknown:
        raise TeamAdminError("Pick stores of this organization only.")
    allowed = {
        str(i) for i in Membership.objects.filter(user_id=actor_user_id, organization_id__in=list(group))
        .values_list("organization_id", flat=True)
    } if actor_user_id else set(group)

    current = {
        str(m.organization_id): m
        for m in Membership.objects.filter(user_id=user_id, organization_id__in=list(group))
    }
    added, removed = [], []
    for store_id in group:
        if store_id == str(organization_id) or store_id not in allowed:
            continue
        has = current.get(store_id)
        if store_id in wanted and not has:
            store_modules = enabled_modules_for_org(store_id)
            own = None
            if membership.page_permissions is not None:
                own = pages.effective_permissions(
                    pages.clean_permissions(membership.page_permissions), store_modules
                )
                modules = pages.modules_for(own) if own else []
            else:
                modules = [m for m in (membership.allowed_modules or []) if m in store_modules]
            if not modules:
                raise TeamAdminError(
                    f"{group[store_id]} has none of the pages this login can open here - "
                    "give the login pages that store uses first."
                )
            Membership.objects.create(
                organization_id=store_id, user_id=user_id, role="org_user",
                allowed_modules=modules, page_permissions=own,
            )
            added.append(group[store_id])
        elif store_id not in wanted and has and has.role == "org_user":
            has.delete()
            removed.append(group[store_id])

    if added or removed:
        write_audit_log(
            organization_id=organization_id,
            action="team.store_access",
            summary=(
                f"Store access for {user_id}: "
                + ", ".join([*(f"+{n}" for n in added), *(f"-{n}" for n in removed)])
            ),
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            entity_type="membership",
            entity_id=str(membership.id),
            metadata={"added": added, "removed": removed},
        )
    return {"added": added, "removed": removed}


def invite_team_member(
    *,
    organization_id,
    username=None,
    email=None,
    password,
    modules=None,
    module=None,
    permissions=None,
    actor_user_id=None,
    actor_email="",
    limit_to_modules=None,
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

    own = None
    if permissions is not None:
        # Pages picked right on the Team form - this login's own access.
        own, resolved = _own_pages(organization_id, permissions)
    else:
        if modules is None and module is None:
            raise TeamAdminError("Pick what this login can open")
        requested = _coerce_modules(modules=modules, module=module)
        _validate_requested_modules(requested, organization_id)
        _check_manageable(requested, limit_to_modules)

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
        page_permissions=own,
    )

    try:
        supabase_admin.set_org_claims(user_id, organization, "org_user", modules=resolved)
    except SupabaseAdminError as exc:
        raise TeamAdminError(exc.message, exc.status_code) from exc

    write_audit_log(
        organization_id=organization_id,
        action="team.invite",
        summary=(
            f"Invited {email} with {len(own)} page(s)" if own is not None
            else f"Invited {email} with modules {', '.join(resolved)}"
        ),
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        entity_type="membership",
        entity_id=str(membership.id),
        metadata={
            "email": email, "modules": resolved, "role": "org_user",
            "page_permissions": own,
        },
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
    permissions=None,
    actor_user_id=None,
    actor_email="",
    limit_to_modules=None,
):
    membership = (
        Membership.objects.select_related("organization")
        .filter(organization_id=organization_id, user_id=user_id, role="org_user")
        .first()
    )
    if not membership:
        raise TeamAdminError("Member not found", 404)
    _check_manageable(membership.allowed_modules, limit_to_modules)

    organization = membership.organization
    resolved = list(membership.allowed_modules or [])
    modules_provided = modules is not None or module is not None
    if permissions is not None:
        own, resolved = _own_pages(organization_id, permissions)
        membership.page_permissions = own
        membership.role_ref = None
        membership.allowed_modules = resolved
        membership.save(update_fields=["page_permissions", "role_ref", "allowed_modules"])
        modules_provided = True
    elif modules_provided:
        requested = _coerce_modules(modules=modules, module=module)
        _validate_requested_modules(requested, organization_id)
        _check_manageable(requested, limit_to_modules)
        resolved = resolve_modules_for_membership(
            role="org_user",
            allowed_modules=requested,
            organization_id=organization_id,
        )
        if not resolved:
            raise TeamAdminError("Could not assign modules")
        # Old-style modules replace any role.
        membership.allowed_modules = resolved
        membership.role_ref = None
        membership.page_permissions = None
        membership.save(update_fields=["allowed_modules", "role_ref", "page_permissions"])

    new_email = None
    if username is not None or email is not None:
        local = username if username is not None else email
        new_email = build_staff_email(organization, local)

    if password is not None and password != "" and len(password) < 8:
        raise TeamAdminError("Password must be at least 8 characters")

    if new_email is None and not password and not modules_provided:
        raise TeamAdminError("Provide access, username, and/or password to update")

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
        summary=(
            f"Updated team member {user_id} pages={membership.page_permissions}"
            if membership.page_permissions is not None
            else f"Updated team member {user_id} modules={resolved}"
        ),
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
    limit_to_modules=None,
):
    membership = Membership.objects.filter(
        organization_id=organization_id, user_id=user_id, role="org_user"
    ).first()
    if not membership:
        raise TeamAdminError("Member not found", 404)
    _check_manageable(membership.allowed_modules, limit_to_modules)
    if str(actor_user_id) == str(user_id):
        raise TeamAdminError("Cannot remove yourself")

    membership_id = str(membership.id)
    membership.delete()

    # Staff logins exist only for this team, so the login itself goes -
    # otherwise the email/password would still sign in. Kept (claims
    # cleared) only if it is somehow still a member of another store.
    try:
        other = Membership.objects.filter(user_id=user_id).select_related("organization").first()
        if other:
            # Still has another store of the organization - sign it in there.
            supabase_admin.set_org_claims(
                str(user_id), other.organization, other.role, modules=other.allowed_modules
            )
        else:
            supabase_admin.delete_user(str(user_id))
    except SupabaseAdminError:
        # The Membership is already gone, and TenantMiddleware refuses any
        # request without one, so a failed cleanup grants nothing.
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
