from rest_framework.permissions import BasePermission

from .models import OrganizationModule


class IsAuthenticatedTenant(BasePermission):
    message = "Authentication required."

    def has_permission(self, request, view):
        if getattr(request, "is_super_admin", False):
            return True
        return bool(getattr(request, "user_id", None) and getattr(request, "organization_id", None))


class IsOrgAdmin(BasePermission):
    message = "Organization admin access required."

    def has_permission(self, request, view):
        if getattr(request, "is_super_admin", False):
            return True
        return bool(
            getattr(request, "user_id", None)
            and getattr(request, "organization_id", None)
            and getattr(request, "is_org_admin", False)
        )


class IsSuperAdmin(BasePermission):
    message = "Super admin access required."

    def has_permission(self, request, view):
        return bool(getattr(request, "is_super_admin", False))


class RequireModule(BasePermission):
    """Gate a view behind org module entitlement AND the caller's JWT modules.

    Set `required_module = "oms"` (or "wms"/"finance") on the view/viewset;
    super admins always pass. Org admins pass if the org has the module
    enabled. Staff must also have the module in request.modules.
    """

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
        org_ok = OrganizationModule.objects.filter(
            organization_id=organization_id,
            module=required_module,
            is_enabled=True,
        ).exists()
        if not org_ok:
            return False
        if getattr(request, "is_org_admin", False):
            return True
        return required_module in (getattr(request, "modules", None) or [])
