class DomainError(Exception):
    """Base domain exception. Routes map these to HTTP responses."""

    def __init__(self, message, code, status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


class UnauthorizedError(DomainError):
    def __init__(self, message="Unauthorized", code="unauthorized"):
        super().__init__(message, code, status=401)


class ForbiddenError(DomainError):
    def __init__(self, message="Forbidden", code="forbidden"):
        super().__init__(message, code, status=403)


class TenantMismatchError(DomainError):
    def __init__(self, message="Tenant scope violation", code="tenant_mismatch"):
        super().__init__(message, code, status=403)


class NotFoundError(DomainError):
    def __init__(self, message="Not found", code="not_found"):
        super().__init__(message, code, status=404)


class ValidationError(DomainError):
    def __init__(self, message="Validation error", code="validation_error"):
        super().__init__(message, code, status=400)


class PlanLimitError(DomainError):
    def __init__(self, message="Plan limit reached", code="plan_limit_reached"):
        super().__init__(message, code, status=402)


class InsufficientStockError(DomainError):
    def __init__(self, message="Stock unavailable", code="stock_unavailable"):
        super().__init__(message, code, status=400)
