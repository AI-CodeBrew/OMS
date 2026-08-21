from .context import current_is_super_admin, current_organization_id, current_user_id
from .jwt_utils import InvalidSupabaseToken, decode_supabase_jwt


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
