import os
from functools import wraps

import jwt
from flask import request

from app.constants import error_codes
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.responses import error
from app.core.tenancy import ROLE_SUPER_ADMIN


def _get_jwt_secret():
    secret = os.getenv("SUPABASE_JWT_SECRET")
    if not secret:
        raise RuntimeError("SUPABASE_JWT_SECRET is not configured")
    return secret


def decode_supabase_jwt(token):
    """Verify Supabase Auth JWT (HS256 with JWT secret)."""
    try:
        payload = jwt.decode(
            token,
            _get_jwt_secret(),
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except jwt.PyJWTError as exc:
        raise UnauthorizedError(
            message="Invalid or expired token",
            code=error_codes.INVALID_TOKEN,
        ) from exc


def _extract_bearer_token():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return header[7:].strip() or None


def _attach_identity(payload):
    user_meta = payload.get("user_metadata") or {}
    app_meta = payload.get("app_metadata") or {}

    role = app_meta.get("role") or user_meta.get("role")
    if not role and app_meta.get("is_super_admin"):
        role = ROLE_SUPER_ADMIN
    if not role:
        role = "tenant_user"

    tenant_id = app_meta.get("tenant_id") or user_meta.get("tenant_id")

    request.user_id = payload.get("sub")
    request.tenant_id = tenant_id
    request.user = {
        "id": request.user_id,
        "email": payload.get("email"),
        "role": role,
        "tenant_id": tenant_id,
        "claims": payload,
    }


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _extract_bearer_token()
        if not token:
            return error("Missing Authorization header", error_codes.UNAUTHORIZED, 401)
        try:
            payload = decode_supabase_jwt(token)
            _attach_identity(payload)
        except UnauthorizedError as exc:
            return error(exc.message, exc.code, exc.status)
        return fn(*args, **kwargs)

    return wrapper


def require_super_admin(fn):
    @wraps(fn)
    @require_auth
    def wrapper(*args, **kwargs):
        if getattr(request, "user", {}).get("role") != ROLE_SUPER_ADMIN:
            return error(
                "Super admin access required",
                error_codes.SUPER_ADMIN_REQUIRED,
                403,
            )
        return fn(*args, **kwargs)

    return wrapper


def require_shopify_auth(fn):
    """Verify Shopify webhook HMAC. Implemented fully when integrations land."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        # Placeholder: integrations module will validate HMAC + resolve tenant
        hmac_header = request.headers.get("X-Shopify-Hmac-Sha256")
        if not hmac_header:
            return error("Missing Shopify HMAC", error_codes.UNAUTHORIZED, 401)
        return fn(*args, **kwargs)

    return wrapper
