import contextvars
from contextlib import contextmanager

# Set once per request by TenantMiddleware, read by TenantScopedModel's
# default manager so queries are scoped without every call site having to
# pass organization_id explicitly.
current_organization_id = contextvars.ContextVar("current_organization_id", default=None)
current_user_id = contextvars.ContextVar("current_user_id", default=None)
current_is_super_admin = contextvars.ContextVar("current_is_super_admin", default=False)

# Set instead of current_organization_id while a super admin operates the
# Dispatch Hub (several stores at once - see middleware.py's X-Dispatch-Hub
# handling): TenantManager then scopes reads to organization_id__in=ids
# rather than a single org. None (not an empty list) when not in hub mode.
current_organization_ids = contextvars.ContextVar("current_organization_ids", default=None)


@contextmanager
def tenant_context(organization_id):
    """Narrows every TenantScopedModel query to one org for the life of the
    `with` block - for code that runs per-store inside a Dispatch Hub
    request (which otherwise has current_organization_ids set, not a single
    current_organization_id), so single-org service functions written
    against ordinary request.organization_id semantics keep working
    unmodified. Also turns off current_is_super_admin for the block, same
    as TenantMiddleware already does for single-store "act as"."""
    org_token = current_organization_id.set(str(organization_id))
    ids_token = current_organization_ids.set(None)
    admin_token = current_is_super_admin.set(False)
    try:
        yield
    finally:
        current_organization_id.reset(org_token)
        current_organization_ids.reset(ids_token)
        current_is_super_admin.reset(admin_token)
