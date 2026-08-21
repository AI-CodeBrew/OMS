from rest_framework.authentication import BaseAuthentication


class SupabaseUser:
    """Stand-in for request.user. Tenant users are never Django auth.User
    rows - their identity lives entirely in the verified Supabase JWT.
    Django's built-in auth.User is reserved for the staff /admin/ panel."""

    is_authenticated = True
    is_anonymous = False

    def __init__(self, user_id, organization_id, is_super_admin):
        self.id = user_id
        self.organization_id = organization_id
        self.is_super_admin = is_super_admin

    def __str__(self):
        return self.id or "anonymous"


class SupabaseJWTAuthentication(BaseAuthentication):
    """Reads the identity TenantMiddleware already parsed off the request
    instead of decoding the JWT a second time."""

    def authenticate(self, request):
        user_id = getattr(request, "user_id", None)
        if not user_id:
            return None
        user = SupabaseUser(
            user_id=user_id,
            organization_id=getattr(request, "organization_id", None),
            is_super_admin=getattr(request, "is_super_admin", False),
        )
        return (user, None)
