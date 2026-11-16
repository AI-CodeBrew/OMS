import logging

from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils.text import slugify

from . import supabase_admin
from .models import Membership, Organization, OrganizationModule
from .rbac import write_audit_log
from .supabase_admin import SupabaseAdminError

logger = logging.getLogger(__name__)


class OrganizationAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _emails_for_user_ids(user_ids):
    """Resolve Auth emails for many user ids with bounded concurrency.

    Avoids the old sequential N+1 (one HTTP round-trip per membership), which
    made the super-admin list feel slower than heavy tenant order pages.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    unique = []
    seen = set()
    for uid in user_ids:
        key = str(uid)
        if key and key not in seen:
            seen.add(key)
            unique.append(key)
    if not unique:
        return {}

    def fetch(uid):
        try:
            user = supabase_admin.get_user(uid)
            return uid, (user or {}).get("email")
        except SupabaseAdminError:
            return uid, None

    emails = {}
    workers = min(8, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch, uid) for uid in unique]
        for fut in as_completed(futures):
            uid, email = fut.result()
            emails[uid] = email
    return emails


def _members_payload(memberships, email_map=None):
    email_map = email_map or {}
    members = []
    for membership in memberships:
        uid = str(membership.user_id)
        members.append(
            {
                "user_id": uid,
                "email": email_map.get(uid),
                "role": membership.role,
                "allowed_modules": list(membership.allowed_modules or []),
                "created_at": membership.created_at.isoformat(),
            }
        )
    return members


def _hub_organization_ids():
    from .models import DispatchHubStore

    return {str(i) for i in DispatchHubStore.objects.values_list("organization_id", flat=True)}


def list_organizations(*, include_emails=False):
    """List orgs from Postgres. Emails are optional (extra Auth Admin calls).

    Org list UI only needs member counts — keep include_emails=False there.
    Users tab should pass include_emails=True.
    """
    # is_platform: FynkTech's own hidden account holder, not a store - see
    # core.platform_service.
    orgs = (
        Organization.objects.filter(is_platform=False)
        .select_related("parent")
        .prefetch_related("memberships", "modules", "child_stores")
        .order_by("-created_at")
    )
    email_map = {}
    if include_emails:
        user_ids = [
            membership.user_id
            for org in orgs
            for membership in org.memberships.all()
        ]
        email_map = _emails_for_user_ids(user_ids)

    # One query for the whole Hub roster rather than one per org below -
    # see _serialize_org's hub_ids param.
    hub_ids = _hub_organization_ids()
    stores_by_org = _stores_by_org()
    bank_by_org = _bank_details_by_org()
    shopify_by_org = _shopify_by_org()

    results = []
    for org in orgs:
        memberships = list(org.memberships.all())
        members = _members_payload(
            memberships, email_map if include_emails else None
        )
        results.append(
            _serialize_org(
                org, members, hub_ids=hub_ids, stores=stores_by_org.get(str(org.id), []),
                bank=bank_by_org.get(str(org.id)),
                shopify_by_org=shopify_by_org,
            )
        )
    return results


def _bank_details_by_org(organization_id=None):
    """{org id: {...}} - each store's bank details (finance.BankDetails,
    where FynkTech remits its COD), for the super admin's Stores tab. One
    query for the whole list."""
    from finance.models import BankDetails

    qs = BankDetails.all_objects.all()
    if organization_id:
        qs = qs.filter(organization_id=organization_id)
    return {
        str(d.organization_id): {
            "account_title": d.account_title,
            "bank_name": d.bank_name,
            "account_number": d.account_number,
            "iban": d.iban,
            "branch_code": d.branch_code,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in qs
    }


def _stores_by_org(organization_id=None):
    """{org id: [{store_id, name}, ...]} - each organization's stores
    (oms.Store: one per shop name its orders carry), by Store ID. One query
    for the whole list."""
    from oms.models import Store

    qs = Store.all_objects.order_by("store_id")
    if organization_id:
        qs = qs.filter(organization_id=organization_id)
    result = {}
    for org_id, store_id, name in qs.values_list("organization_id", "store_id", "name"):
        result.setdefault(str(org_id), []).append({"store_id": store_id, "name": name})
    return result


def get_organization(organization_id):
    try:
        org = (
            Organization.objects.filter(is_platform=False)
            .prefetch_related("memberships", "modules")
            .get(id=organization_id)
        )
    except Organization.DoesNotExist as exc:
        raise OrganizationAdminError("Organization not found", 404) from exc

    memberships = list(org.memberships.all())
    email_map = _emails_for_user_ids([m.user_id for m in memberships])
    return _serialize_org(org, _members_payload(memberships, email_map))


@transaction.atomic
def create_organization_with_admin(
    *,
    name,
    email,
    password,
    plan="starter",
    slug=None,
    modules=None,
):
    name = (name or "").strip()
    email = (email or "").strip().lower()
    password = password or ""
    if not name:
        raise OrganizationAdminError("Organization name is required")
    if not email:
        raise OrganizationAdminError("Admin email is required")
    if len(password) < 8:
        raise OrganizationAdminError("Password must be at least 8 characters")

    org_slug = slugify(slug or name)
    if not org_slug:
        raise OrganizationAdminError("Could not derive a valid slug from the name")
    if Organization.objects.filter(slug=org_slug).exists():
        raise OrganizationAdminError(f"Organization slug '{org_slug}' already exists")

    module_list = modules or ["oms", "ims", "wms"]
    module_list = [m.strip() for m in module_list if m and m.strip()]

    organization = Organization.objects.create(
        name=name,
        slug=org_slug,
        plan=plan or "starter",
        is_active=True,
    )

    for module in module_list:
        OrganizationModule.objects.create(
            organization=organization,
            module=module,
            is_enabled=True,
        )

    try:
        user = supabase_admin.create_user(
            email=email,
            password=password,
            app_metadata={
                "organization_id": str(organization.id),
                "organization_name": organization.name,
                "role": "org_admin",
                "modules": module_list,
            },
        )
    except SupabaseAdminError as exc:
        raise OrganizationAdminError(exc.message, exc.status_code) from exc

    user_id = user.get("id")
    if not user_id:
        raise OrganizationAdminError("Supabase did not return a user id", 500)

    Membership.objects.create(
        organization=organization,
        user_id=user_id,
        role="org_admin",
        allowed_modules=module_list,
    )

    return get_organization(organization.id)


def _resync_available(org):
    from integrations.services import shopify_resync_available

    return shopify_resync_available(org)


def set_shopify_resync(organization_id, *, enabled, actor_user_id=None, actor_email=""):
    """The super admin's "Keep updating orders from Shopify" switch (OMS
    Testing only - integrations.services.SHOPIFY_RESYNC_STORES). Turning it
    on also starts a full Shopify order sync, so the store's existing orders
    are updated at once."""
    org = Organization.objects.filter(id=organization_id, is_platform=False).first()
    if not org:
        raise OrganizationAdminError("Organization not found", 404)
    if not _resync_available(org):
        raise OrganizationAdminError("This switch is only available for OMS Testing.")
    enabled = bool(enabled)
    org.shopify_resync_orders = enabled
    org.save(update_fields=["shopify_resync_orders", "updated_at"])
    job = None
    if enabled:
        from integrations.services import start_full_order_sync

        job = start_full_order_sync(org.id)
    write_audit_log(
        organization_id=org.id,
        action="org.shopify_resync",
        summary=f"Keep updating orders from Shopify turned {'on' if enabled else 'off'}"
        + (" - full order sync started" if job else ""),
        actor_user_id=actor_user_id,
        actor_email=actor_email,
    )
    result = get_organization(org.id)
    result["resync_job_started"] = bool(job)
    return result


def set_service_model(organization_id, *, service_model, actor_user_id=None, actor_email=""):
    """The Stores tab's Service model - one of Organization.SERVICE_MODEL_CHOICES,
    or blank to clear it."""
    try:
        org = Organization.objects.get(id=organization_id, is_platform=False)
    except Organization.DoesNotExist as exc:
        raise OrganizationAdminError("Organization not found", 404) from exc
    value = (service_model or "").strip()
    labels = dict(Organization.SERVICE_MODEL_CHOICES)
    if value and value not in labels:
        raise OrganizationAdminError("Pick a service model from the list.")
    if org.service_model != value:
        old = labels.get(org.service_model, "Not set")
        org.service_model = value
        org.save(update_fields=["service_model", "updated_at"])
        write_audit_log(
            organization_id=org.id,
            action="organization.service_model",
            summary=f"Service model: {old} -> {labels.get(value, 'Not set')}",
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            entity_type="organization",
            entity_id=str(org.id),
        )
    return get_organization(org.id)


def set_organization_active(organization_id, *, is_active, actor_user_id=None, actor_email=""):
    """Suspends (is_active=False) or reactivates an organization. A suspended
    org's users are turned away by TenantMiddleware on every request -
    including the check the login page makes right after signing in - so
    nothing in Supabase Auth needs changing."""
    try:
        org = Organization.objects.get(id=organization_id, is_platform=False)
    except Organization.DoesNotExist as exc:
        raise OrganizationAdminError("Organization not found", 404) from exc

    is_active = bool(is_active)
    if org.is_active != is_active:
        org.is_active = is_active
        org.save(update_fields=["is_active", "updated_at"])
        write_audit_log(
            organization_id=org.id,
            action="organization.reactivated" if is_active else "organization.suspended",
            summary=f"{'Reactivated' if is_active else 'Suspended'} by super admin",
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            entity_type="organization",
            entity_id=str(org.id),
        )
    return get_organization(org.id)


def delete_organization(organization_id, *, confirm_name, actor_email=""):
    """Permanently removes an organization and everything it owns - every
    tenant table cascades from Organization - then deletes its users'
    Supabase logins. `confirm_name` must match the org's name exactly, so a
    stray request can't wipe a tenant.

    Logins are deleted only after the database delete commits, and only for
    users with no membership left elsewhere. A login that fails to delete
    is reported back rather than failing the removal: with its org gone,
    TenantMiddleware already turns that user away."""
    try:
        org = Organization.objects.get(id=organization_id, is_platform=False)
    except Organization.DoesNotExist as exc:
        raise OrganizationAdminError("Organization not found", 404) from exc

    if (confirm_name or "").strip() != org.name:
        raise OrganizationAdminError("Type the organization's exact name to confirm removal.")

    if org.child_stores.exists():
        # They share its inventory, which would go with it.
        raise OrganizationAdminError(
            f"{org.name} has other stores inside it - remove them from the organization first.", 409
        )

    name = org.name
    user_ids = [str(uid) for uid in org.memberships.values_list("user_id", flat=True)]
    try:
        with transaction.atomic():
            org.delete()
    except (IntegrityError, ProtectedError) as exc:
        logger.exception("removing organization %s failed", organization_id)
        raise OrganizationAdminError(f"Couldn't remove {name}: {exc}", 409) from exc

    still_member = {
        str(uid)
        for uid in Membership.objects.filter(user_id__in=user_ids).values_list("user_id", flat=True)
    }
    users_removed = 0
    user_errors = []
    for uid in user_ids:
        if uid in still_member:
            continue
        try:
            supabase_admin.delete_user(uid)
            users_removed += 1
        except SupabaseAdminError as exc:
            user_errors.append({"user_id": uid, "error": exc.message})

    # The org's own audit log went with it, so this is the lasting record.
    logger.warning(
        "organization %s (%s) removed by %s - %s login(s) deleted, %s failed",
        name, organization_id, actor_email or "unknown", users_removed, len(user_errors),
    )
    return {"name": name, "users_removed": users_removed, "user_errors": user_errors}


def update_member_credentials(user_id, *, email=None, password=None):
    if email is None and password is None:
        raise OrganizationAdminError("Provide email and/or password to update")
    if password is not None and len(password) < 8:
        raise OrganizationAdminError("Password must be at least 8 characters")
    if email is not None:
        email = email.strip().lower()
        if not email:
            raise OrganizationAdminError("Email cannot be empty")

    membership = Membership.objects.select_related("organization").filter(user_id=user_id).first()
    if not membership:
        raise OrganizationAdminError("User is not linked to any organization", 404)

    try:
        user = supabase_admin.update_user(
            str(user_id),
            email=email,
            password=password,
        )
    except SupabaseAdminError as exc:
        raise OrganizationAdminError(exc.message, exc.status_code) from exc

    return {
        "user_id": str(user_id),
        "email": user.get("email") or email,
        "organization_id": str(membership.organization_id),
        "organization_name": membership.organization.name,
        "role": membership.role,
        "updated": {
            "email": email is not None,
            "password": password is not None,
        },
    }


def _shopify_by_org(organization_id=None):
    """{org id: its newest ShopifyConnection} - one query for the whole
    list rather than one per organization (each query is a round trip to
    the database, ~0.15 s from the live server)."""
    from integrations.models import ShopifyConnection

    qs = ShopifyConnection.all_objects.order_by("organization_id", "-updated_at")
    if organization_id:
        qs = qs.filter(organization_id=organization_id)
    result = {}
    for conn in qs:
        result.setdefault(str(conn.organization_id), conn)
    return result


def _serialize_org(org, members, hub_ids=None, stores=None, bank=False, shopify_by_org=None):
    shopify = None
    try:
        if shopify_by_org is None:
            shopify_by_org = _shopify_by_org(org.id)
        conn = shopify_by_org.get(str(org.id))
        if conn:
            shopify = {
                "shop_domain": conn.shop_domain,
                "shop_name": conn.shop_name,
                "is_connected": conn.is_connected,
                # When the store first connected Shopify to OMS.
                "connected_at": conn.created_at.isoformat() if conn.created_at else None,
                "last_synced_at": (
                    conn.last_synced_at.isoformat() if conn.last_synced_at else None
                ),
            }
    except Exception:
        shopify = None

    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "plan": org.plan,
        "is_active": org.is_active,
        "is_manual_store": org.is_manual_store,
        "store_code": org.store_code,
        "service_model": org.service_model,
        # "Keep updating orders from Shopify" - only where available.
        "shopify_resync_orders": org.shopify_resync_orders,
        "shopify_resync_available": _resync_available(org),
        # Organization with several stores (core.org_group): the main
        # store it is inside, or the stores inside it.
        "parent_id": str(org.parent_id) if org.parent_id else None,
        "parent_name": org.parent.name if org.parent_id else "",
        # Sorted here, not with order_by(), so the list's prefetch is used.
        "child_stores": [
            {"id": str(c.id), "name": c.name, "store_code": c.store_code, "is_active": c.is_active}
            for c in sorted(org.child_stores.all(), key=lambda c: c.name.lower())
        ],
        # Its stores (shop names) with their Store IDs - the orders report's
        # Store ID column.
        "stores": stores if stores is not None else _stores_by_org(org.id).get(str(org.id), []),
        # Where FynkTech remits its COD - null until the store saves them
        # (asked before its first integration / store create).
        "bank_details": bank if bank is not False else _bank_details_by_org(org.id).get(str(org.id)),
        "in_dispatch_hub": (
            str(org.id) in hub_ids if hub_ids is not None else hasattr(org, "dispatch_hub_entry")
        ),
        "created_at": org.created_at.isoformat(),
        "modules": [
            {"module": m.module, "is_enabled": m.is_enabled} for m in org.modules.all()
        ],
        "members": members,
        "shopify": shopify,
    }
