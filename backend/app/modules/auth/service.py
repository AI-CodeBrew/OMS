from app.clients.supabase_client import TABLE_PROFILES, get_supabase
from app.constants import error_codes
from app.core.errors import NotFoundError, UnauthorizedError, ValidationError


class AuthService:
    def login(self, email, password):
        if not email or not password:
            raise ValidationError("Email and password are required")

        supabase = get_supabase()
        try:
            result = supabase.client.auth.sign_in_with_password(
                {"email": email, "password": password}
            )
        except Exception as exc:
            raise UnauthorizedError(
                message="Invalid email or password",
                code=error_codes.UNAUTHORIZED,
            ) from exc

        session = result.session
        user = result.user
        if not session or not user:
            raise UnauthorizedError("Invalid email or password")

        profile = self._load_profile(user.id)

        return {
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_in": session.expires_in,
            "user": {
                "id": user.id,
                "email": user.email,
                "role": profile.get("role"),
                "tenant_id": profile.get("tenant_id"),
                "full_name": profile.get("full_name"),
            },
        }

    def me(self, user_id):
        profile = self._load_profile(user_id)
        return {
            "id": profile.get("id") or user_id,
            "email": profile.get("email"),
            "role": profile.get("role"),
            "tenant_id": profile.get("tenant_id"),
            "full_name": profile.get("full_name"),
        }

    def _load_profile(self, user_id):
        supabase = get_supabase()
        result = (
            supabase.table(TABLE_PROFILES)
            .select("id, email, role, tenant_id, full_name")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if not rows:
            raise NotFoundError("Profile not found")
        return rows[0]


auth_service = AuthService()
