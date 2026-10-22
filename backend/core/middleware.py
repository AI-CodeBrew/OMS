import logging
import uuid

from django.conf import settings
from django.http import HttpResponseForbidden, JsonResponse

from .context import (
    current_is_super_admin,
    current_organization_id,
    current_organization_ids,
    current_request_meta,
    current_user_id,
)
from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt

logger = logging.getLogger(__name__)

# Paths that require an allowlisted client IP (super-admin APIs).
ADMIN_API_PREFIXES = ("/api/core/admin/",)

# A user whose CURRENT store got suspended must still be able to list their
# other stores and switch into one - see the suspended-org gate below.
STORE_SWITCH_PREFIXES = ("/api/core/stores/",)

ACT_AS_HEADER = "HTTP_X_ACT_AS_ORGANIZATION"
# Operate every store in the Dispatch Hub at once instead of a single
# "act as" store - mutually exclusive with ACT_AS_HEADER (the frontend
# only ever sends one or the other).
HUB_HEADER = "HTTP_X_DISPATCH_HUB"
MUTATING_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# The login is valid but its Membership in this store is gone (removed from
# the team, or the store taken away) - see the membership gate below.
ACCESS_REVOKED_CODE = "access_revoked"
ACCESS_REVOKED_MESSAGE = (
    "Your access to this store has been removed. Please contact your store admin."
)

ORG_SUSPENDED_CODE = "organization_suspended"
ORG_SUSPENDED_MESSAGE = (
    "Your organization's account has been suspended. Please contact the FynkTech team."
)


def resolve_active_org_id(raw):
    """Returns the org id as a string if `raw` names an active organization, else None."""
    from .models import Organization

    try:
        org_id = uuid.UUID(str(raw).strip())
    except (ValueError, TypeError):
        return None
    if not Organization.objects.filter(id=org_id, is_active=True).exists():
        return None
    return str(org_id)


def get_client_ip(request):
    """Prefer leftmost X-Forwarded-For hop (Fly proxy/Cloudflare), else REMOTE_ADDR."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.META.get("HTTP_X_REAL_IP")
    if real_ip:
        return real_ip.strip()
    return (request.META.get("REMOTE_ADDR") or "").strip()


class AdminIPAllowlistMiddleware:
    """Block non-allowlisted IPs from super-admin API routes.

    Allowlist comes from ADMIN_IP_ALLOWLIST (comma-separated) in env.
    Include 127.0.0.1 for local Django development.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        raw = getattr(settings, "ADMIN_IP_ALLOWLIST", "") or ""
        if isinstance(raw, str):
            self.allowlist = {ip.strip() for ip in raw.split(",") if ip.strip()}
        else:
            self.allowlist = set(raw)

    def __call__(self, request):
        # IP restriction commented out to allow superadmin access from any IP
        # path = request.path
        # if any(path.startswith(prefix) for prefix in ADMIN_API_PREFIXES):
        #     client_ip = get_client_ip(request)
        #     if client_ip not in self.allowlist:
        #         return HttpResponseForbidden("Access denied")
        return self.get_response(request)


class TenantMiddleware:
    """Resolves the caller's identity from the Supabase JWT once per
    request. Sets it both on the request object (for views/permissions)
    and as contextvars (so TenantScopedModel's manager can filter
    querysets from anywhere, including code that never sees `request`)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.user_id = None
        request.organization_id = None
        request.organization_ids = None
        request.is_super_admin = False
        request.is_org_admin = False
        request.modules = []
        request.auth_claims = None
        request.auth_email = None
        request.acting_as_org = False

        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):].strip()
            try:
                claims = decode_supabase_jwt(token)
            except InvalidSupabaseToken:
                claims = None
            if claims:
                # app_metadata only: user_metadata is writable by the user
                # themselves (supabase.auth.updateUser), so nothing that
                # decides access may ever be read from it.
                app_meta = claims.get("app_metadata") or {}
                request.user_id = claims.get("sub")
                request.auth_email = claims.get("email") or ""
                role = app_meta.get("role") or ""
                request.is_super_admin = role == "super_admin"
                request.is_org_admin = role == "org_admin"
                request.organization_id = app_meta.get("organization_id")
                modules = app_meta.get("modules")
                if isinstance(modules, list):
                    request.modules = [str(m) for m in modules if m]
                elif request.is_org_admin and request.organization_id:
                    # Legacy org_admin JWTs without modules claim → full enabled set
                    from .rbac import enabled_modules_for_org

                    request.modules = enabled_modules_for_org(request.organization_id)
                request.auth_claims = claims

        # A suspended org (Organization.is_active=False, set from the super
        # admin's Organizations page) - or one that has been removed - turns
        # its users away on every request. Supabase still lets them sign in,
        # so this is also what the login page's post-sign-in check hits.
        # Both message keys, since frontend helpers read one or the other.
        if (
            request.organization_id
            and not request.is_super_admin
            and not request.path.startswith(STORE_SWITCH_PREFIXES)
            and resolve_active_org_id(request.organization_id) is None
        ):
            return JsonResponse(
                {
                    "success": False,
                    "detail": ORG_SUSPENDED_MESSAGE,
                    "error": ORG_SUSPENDED_MESSAGE,
                    "code": ORG_SUSPENDED_CODE,
                },
                status=403,
            )

        # The JWT's role/modules are a snapshot from sign-in and stay valid
        # until it expires (an hour by default), so a removed or downgraded
        # member would keep their old access that long. The Membership row
        # is the live truth: no row, no access; and role/modules come from
        # it, not the token. Store-switch paths do their own Membership
        # checks and must stay reachable to move to another store.
        if (
            request.organization_id
            and request.user_id
            and not request.is_super_admin
            and not request.path.startswith(STORE_SWITCH_PREFIXES)
        ):
            from .models import Membership
            from .rbac import resolve_modules_for_membership

            membership = (
                Membership.objects.filter(
                    organization_id=request.organization_id, user_id=request.user_id
                )
                .only("role", "allowed_modules")
                .first()
            )
            if membership is None:
                return JsonResponse(
                    {
                        "success": False,
                        "detail": ACCESS_REVOKED_MESSAGE,
                        "error": ACCESS_REVOKED_MESSAGE,
                        "code": ACCESS_REVOKED_CODE,
                    },
                    status=403,
                )
            request.is_org_admin = membership.role == "org_admin"
            request.modules = resolve_modules_for_membership(
                role=membership.role,
                allowed_modules=membership.allowed_modules,
                organization_id=request.organization_id,
            )

        act_as = request.META.get(ACT_AS_HEADER)
        hub = request.META.get(HUB_HEADER)
        is_admin_api = request.path.startswith(ADMIN_API_PREFIXES)
        if act_as and request.is_super_admin and not is_admin_api:
            org_id = resolve_active_org_id(act_as)
            if not org_id:
                return JsonResponse(
                    {"detail": "Store not found or inactive."}, status=403
                )
            from .rbac import enabled_modules_for_org

            request.organization_id = org_id
            request.acting_as_org = True
            request.is_org_admin = True
            request.modules = enabled_modules_for_org(org_id)
        elif hub and request.is_super_admin and not is_admin_api:
            from .dispatch_hub_service import active_hub_organization_ids

            org_ids = [str(i) for i in active_hub_organization_ids()]
            if not org_ids:
                return JsonResponse(
                    {"detail": "No stores in the Dispatch Hub."}, status=403
                )
            request.organization_ids = org_ids
            request.acting_as_org = True
            request.is_org_admin = True
            # Hub stores vary in which modules they themselves have enabled,
            # but FynkTech dispatches regardless of that - Orders/Batch/
            # Returns/Reports (oms+wms) are always available from here.
            request.modules = ["oms", "wms"]

        # While acting as a store (or several, in the Hub), the ORM must
        # scope to those stores only - TenantManager returns every org's
        # rows when is_super_admin is set.
        org_token = current_organization_id.set(request.organization_id)
        orgs_token = current_organization_ids.set(request.organization_ids)
        user_token = current_user_id.set(request.user_id)
        admin_token = current_is_super_admin.set(
            request.is_super_admin and not request.acting_as_org
        )
        request_meta = self._request_meta(request)
        meta_token = current_request_meta.set(request_meta)
        audit = self._should_audit(request)
        body = None
        if audit:
            from .activity_log_service import capture_body

            body = capture_body(request)
        try:
            response = self.get_response(request)
            if audit and not request_meta.get("audited"):
                self._audit_request(request, response, body)
            return response
        finally:
            current_organization_id.reset(org_token)
            current_organization_ids.reset(orgs_token)
            current_user_id.reset(user_token)
            current_is_super_admin.reset(admin_token)
            current_request_meta.reset(meta_token)

    @staticmethod
    def _request_meta(request):
        from .models import OrganizationAuditLog as Log

        if request.is_super_admin:
            role = Log.ROLE_SUPER_ADMIN
        elif request.is_org_admin:
            role = Log.ROLE_STORE_ADMIN
        elif request.user_id:
            role = Log.ROLE_STORE_USER
        else:
            role = Log.ROLE_SYSTEM  # webhooks - Shopify, couriers
        return {
            "user_id": request.user_id,
            "email": request.auth_email or "",
            "role": role,
            "ip": get_client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            "method": request.method,
            "path": request.path,
            "audited": False,
        }

    @staticmethod
    def _should_audit(request):
        from .activity_log_service import SKIP_PATHS

        return (
            request.method in MUTATING_METHODS
            and bool(request.user_id)
            and request.path.startswith("/api/")
            and not request.path.startswith(SKIP_PATHS)
        )

    @staticmethod
    def _audit_request(request, response, body):
        """One row per store the request touched, for a create/edit/delete
        no service wrote its own audit row for. A super admin's admin-panel
        request lands on the store it names, or on no store at all."""
        from .activity_log_service import category_for, describe_request, sanitize_body
        from .models import Organization, OrganizationAuditLog

        try:
            action, summary, entity_type, entity_id = describe_request(request, body)
            if request.organization_ids:
                org_ids = request.organization_ids
            elif request.organization_id:
                org_ids = [request.organization_id]
            elif entity_type == "organization" and Organization.objects.filter(id=entity_id).exists():
                org_ids = [entity_id]
            else:
                org_ids = [None]
            status_code = getattr(response, "status_code", None)
            meta = current_request_meta.get() or {}
            metadata = {"body": sanitize_body(body)} if body is not None else {}
            if request.organization_ids:
                metadata["dispatch_hub"] = True
            for org_id in org_ids:
                OrganizationAuditLog.all_objects.create(
                    organization_id=org_id,
                    actor_user_id=request.user_id,
                    actor_email=(request.auth_email or "")[:255],
                    actor_role=meta.get("role", ""),
                    action=action,
                    category=category_for(action, request.path),
                    entity_type=entity_type[:64],
                    entity_id=entity_id[:64],
                    summary=summary[:500],
                    metadata=metadata,
                    ip_address=meta.get("ip", "")[:64],
                    user_agent=meta.get("user_agent", "")[:300],
                    request_method=request.method,
                    request_path=request.path[:255],
                    status_code=status_code,
                )
        except Exception:
            logger.exception("Failed to write request audit log for %s %s", request.method, request.path)
