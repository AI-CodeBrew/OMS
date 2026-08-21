from rest_framework.permissions import BasePermission

from .models import OrganizationModule


class RequireModule(BasePermission):
    """Gate a view behind an OrganizationModule entitlement. Set
    `required_module = "oms"` (or "wms"/"finance") on the view/viewset;
    super admins always pass."""

    message = "Your organization does not have access to this module."

    def has_permission(self, request, view):
        required_module = getattr(view, "required_module", None)
        if required_module is None:
            return True
        if getattr(request, "is_super_admin", False):
            return True
        organization_id = getattr(request, "organization_id", None)
        if not organization_id:
            return False
        return OrganizationModule.objects.filter(
            organization_id=organization_id,
            module=required_module,
            is_enabled=True,
        ).exists()
