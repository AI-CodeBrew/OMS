import requests
from django.conf import settings


class SupabaseAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _headers():
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise SupabaseAdminError("SUPABASE_SERVICE_ROLE_KEY is not configured", 500)
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _url(path):
    base = settings.SUPABASE_URL.rstrip("/")
    return f"{base}/auth/v1/admin/{path.lstrip('/')}"


def create_user(*, email, password, app_metadata=None):
    """Create a confirmed Auth user. Returns the user dict from Supabase."""
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": app_metadata or {},
    }
    response = requests.post(_url("users"), json=payload, headers=_headers(), timeout=20)
    if not response.ok:
        raise SupabaseAdminError(
            _extract_error(response) or "Failed to create user",
            status_code=response.status_code,
        )
    return response.json()


def update_user(user_id, *, email=None, password=None, app_metadata=None):
    payload = {}
    if email is not None:
        payload["email"] = email
        payload["email_confirm"] = True
    if password is not None:
        payload["password"] = password
    if app_metadata is not None:
        payload["app_metadata"] = app_metadata
    if not payload:
        raise SupabaseAdminError("No fields to update")

    response = requests.put(
        _url(f"users/{user_id}"), json=payload, headers=_headers(), timeout=20
    )
    if not response.ok:
        raise SupabaseAdminError(
            _extract_error(response) or "Failed to update user",
            status_code=response.status_code,
        )
    return response.json()


def get_user(user_id):
    response = requests.get(_url(f"users/{user_id}"), headers=_headers(), timeout=20)
    if response.status_code == 404:
        return None
    if not response.ok:
        raise SupabaseAdminError(
            _extract_error(response) or "Failed to fetch user",
            status_code=response.status_code,
        )
    return response.json()


def find_user_by_email(email):
    """Best-effort lookup. Pages through admin users until a match is found."""
    email = (email or "").strip().lower()
    if not email:
        return None
    page = 1
    per_page = 200
    while page <= 20:
        response = requests.get(
            _url(f"users?page={page}&per_page={per_page}"),
            headers=_headers(),
            timeout=20,
        )
        if not response.ok:
            raise SupabaseAdminError(
                _extract_error(response) or "Failed to list users",
                status_code=response.status_code,
            )
        data = response.json() or {}
        users = data.get("users") or []
        for user in users:
            if (user.get("email") or "").lower() == email:
                return user
        if len(users) < per_page:
            break
        page += 1
    return None


def ensure_user(*, email, password, app_metadata=None):
    """Create the user, or update password/claims if the email already exists."""
    existing = find_user_by_email(email)
    if existing:
        return update_user(
            existing["id"],
            password=password,
            app_metadata=app_metadata,
        )
    try:
        return create_user(email=email, password=password, app_metadata=app_metadata)
    except SupabaseAdminError as exc:
        # Race / duplicate: fall back to update
        existing = find_user_by_email(email)
        if existing:
            return update_user(
                existing["id"],
                password=password,
                app_metadata=app_metadata,
            )
        raise


def set_org_claims(user_id, organization, role):
    return update_user(
        user_id,
        app_metadata={
            "organization_id": str(organization.id),
            "organization_name": organization.name,
            "role": role,
        },
    )


def _extract_error(response):
    try:
        data = response.json()
    except Exception:
        return response.text[:300]
    return data.get("msg") or data.get("error_description") or data.get("message") or data.get("error")
