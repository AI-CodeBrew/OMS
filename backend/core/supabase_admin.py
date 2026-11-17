import requests
from django.conf import settings


class SupabaseAdminError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# Super admin logins (app_metadata role "super_admin": the owner, and the
# Admin Team's staff) are never changed or deleted from OMS - not from a
# store's member screen, a store's team, store switching or creating a
# store with an email that already exists (user, 2026-11-17, after a store
# member edit changed the owner's password because the store's admin was
# the owner's own login). The owner's login is changed by FynkTech outside
# OMS (bootstrap_super_admin, allow_super_admin=True); the Admin Team page
# may still reset its staff's passwords (allow_admin_staff=True).
PROTECTED_LOGIN_MESSAGE = (
    "This is a super admin login - it can't be changed from OMS. "
    "Give the store its own email instead."
)


def is_super_admin_user(user):
    return ((user or {}).get("app_metadata") or {}).get("role") == "super_admin"


def _check_not_protected(user_id, *, allow_super_admin=False, allow_admin_staff=False, user=None):
    """Raises SupabaseAdminError (403) when `user_id` is a super admin login
    this call may not touch. Fails closed: a login that can't be read is
    not changed."""
    if allow_super_admin:
        return
    if user is None:
        user = get_user(user_id)
    if not is_super_admin_user(user):
        return
    if allow_admin_staff and (user.get("app_metadata") or {}).get("admin_staff"):
        return
    raise SupabaseAdminError(PROTECTED_LOGIN_MESSAGE, status_code=403)


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


def update_user(user_id, *, email=None, password=None, app_metadata=None,
                allow_super_admin=False, allow_admin_staff=False):
    _check_not_protected(
        user_id, allow_super_admin=allow_super_admin, allow_admin_staff=allow_admin_staff
    )
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


def delete_user(user_id, *, allow_admin_staff=False):
    """Deletes the Auth user. Already gone (404) counts as done. Never a
    super admin login (_check_not_protected) - except an Admin Team staff
    login being removed from the Admin Team page (allow_admin_staff)."""
    existing = get_user(user_id)
    if existing is None:
        return
    _check_not_protected(user_id, user=existing, allow_admin_staff=allow_admin_staff)
    response = requests.delete(_url(f"users/{user_id}"), headers=_headers(), timeout=20)
    if response.status_code == 404:
        return
    if not response.ok:
        raise SupabaseAdminError(
            _extract_error(response) or "Failed to delete user",
            status_code=response.status_code,
        )


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


def ensure_user(*, email, password, app_metadata=None, allow_super_admin=False):
    """Create the user, or update password/claims if the email already
    exists - never a super admin login's, unless allow_super_admin
    (bootstrap_super_admin only)."""
    existing = find_user_by_email(email)
    if existing:
        return update_user(
            existing["id"],
            password=password,
            app_metadata=app_metadata,
            allow_super_admin=allow_super_admin,
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
                allow_super_admin=allow_super_admin,
            )
        raise


def set_org_claims(user_id, organization, role, modules=None):
    """Write org identity into Supabase app_metadata (source of truth for JWT)."""
    from .rbac import build_org_app_metadata, enabled_modules_for_org, resolve_modules_for_membership

    if modules is None:
        if role == "org_admin":
            modules = enabled_modules_for_org(organization.id)
        else:
            modules = []
    else:
        modules = resolve_modules_for_membership(
            role=role,
            allowed_modules=modules,
            organization_id=organization.id,
        )
    return update_user(
        user_id,
        app_metadata=build_org_app_metadata(organization, role=role, modules=modules),
    )


def _extract_error(response):
    try:
        data = response.json()
    except Exception:
        return response.text[:300]
    return data.get("msg") or data.get("error_description") or data.get("message") or data.get("error")
