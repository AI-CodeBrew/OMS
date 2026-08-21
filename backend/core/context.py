import contextvars

# Set once per request by TenantMiddleware, read by TenantScopedModel's
# default manager so queries are scoped without every call site having to
# pass organization_id explicitly.
current_organization_id = contextvars.ContextVar("current_organization_id", default=None)
current_user_id = contextvars.ContextVar("current_user_id", default=None)
current_is_super_admin = contextvars.ContextVar("current_is_super_admin", default=False)
