from functools import wraps

from flask import request

from app.constants import error_codes
from app.core.errors import TenantMismatchError


ROLE_SUPER_ADMIN = "super_admin"
ROLE_TENANT_ADMIN = "tenant_admin"
ROLE_TENANT_USER = "tenant_user"


def is_super_admin(user=None):
    user = user or getattr(request, "user", None) or {}
    return user.get("role") == ROLE_SUPER_ADMIN


def require_tenant_scope(resource_tenant_id):
    """Raise if caller is not super admin and resource belongs to another tenant."""
    if is_super_admin():
        return
    if str(request.tenant_id) != str(resource_tenant_id):
        raise TenantMismatchError(
            message="Resource does not belong to your tenant",
            code=error_codes.TENANT_MISMATCH,
        )


def tenant_filter(query_builder, tenant_id=None):
    """Apply tenant_id filter unless super admin and tenant_id explicitly None."""
    if tenant_id is None:
        if is_super_admin():
            return query_builder
        tenant_id = request.tenant_id
    return query_builder.eq("tenant_id", tenant_id)


def scoped(fn):
    """Decorator asserting request.tenant_id is set for non-super-admin callers."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not is_super_admin() and not getattr(request, "tenant_id", None):
            raise TenantMismatchError(
                message="Missing tenant context",
                code=error_codes.TENANT_MISMATCH,
            )
        return fn(*args, **kwargs)

    return wrapper
