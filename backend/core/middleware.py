from django.conf import settings
from django.http import HttpResponseForbidden

from .context import current_is_super_admin, current_organization_id, current_user_id
from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt

# Paths that require an allowlisted client IP (super-admin APIs).
ADMIN_API_PREFIXES = ("/api/core/admin/",)


def get_client_ip(request):
    """Prefer leftmost X-Forwarded-For hop (Render/Cloudflare), else REMOTE_ADDR."""
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
        path = request.path
        if any(path.startswith(prefix) for prefix in ADMIN_API_PREFIXES):
            client_ip = get_client_ip(request)
            if client_ip not in self.allowlist:
                return HttpResponseForbidden("Access denied")
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
        request.is_super_admin = False
        request.auth_claims = None

        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):].strip()
            try:
                claims = decode_supabase_jwt(token)
            except InvalidSupabaseToken:
                claims = None
            if claims:
                app_meta = claims.get("app_metadata") or {}
                user_meta = claims.get("user_metadata") or {}
                request.user_id = claims.get("sub")
                request.is_super_admin = app_meta.get("role") == "super_admin"
                request.organization_id = (
                    app_meta.get("organization_id") or user_meta.get("organization_id")
                )
                request.auth_claims = claims

        org_token = current_organization_id.set(request.organization_id)
        user_token = current_user_id.set(request.user_id)
        admin_token = current_is_super_admin.set(request.is_super_admin)
        try:
            return self.get_response(request)
        finally:
            current_organization_id.reset(org_token)
            current_user_id.reset(user_token)
            current_is_super_admin.reset(admin_token)
