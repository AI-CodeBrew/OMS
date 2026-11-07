from rest_framework.permissions import SAFE_METHODS, BasePermission

from . import pages
from .models import OrganizationModule
from .rbac import org_module_for


def view_pages(view, need, modules):
    """The pages a request to `view` counts against. A view can declare
    `page_access = {"*": {"read": (...), "write": (...)}, "<action>": {...}}`
    (action = the viewset action); a missing "write" means no page lets
    you change anything there. Views without it count against every page
    of their module(s)."""
    access = getattr(view, "page_access", None)
    if access:
        rule = access.get(getattr(view, "action", None)) or access.get("*")
        if rule is not None:
            return tuple(rule.get(need) or ())
    return tuple(pages.pages_of_modules(modules))


def page_allowed(request, view, modules):
    """Staff (request.page_permissions set by TenantMiddleware): reading
    needs read or write on one of the view's pages, any other method needs
    write. Admins / super admin / Dispatch Hub (None) aren't limited."""
    granted = getattr(request, "page_permissions", None)
    if granted is None:
        return True
    need = pages.READ if request.method in SAFE_METHODS else pages.WRITE
    return pages.allows(granted, view_pages(view, need, modules), need)


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


class CanManageTeam(IsOrgAdmin):
    """Staff logins and roles: the store admin only (and super admin)."""


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
        if getattr(request, "page_permissions", None) is not None:
            return page_allowed(request, view, [required_module])
        return required_module in (getattr(request, "modules", None) or [])


class RequireAnyModule(BasePermission):
    """Like RequireModule, but passes if the caller has ANY ONE of several
    modules - for the handful of actions that are legitimately shared
    across two apps' staff (e.g. Returns Desk and Packing are WMS pages,
    but the orders they work with live in the oms app; a wms-only staff
    member still needs to read that order data for exactly those pages,
    without opening up the rest of OrderViewSet - create, bulk actions,
    export - which stay oms-only).

    Set `required_any_module = ("oms", "wms")` on the view/viewset. A
    staff-only role like "returns" (Returns Associate) is checked against
    the org module it rides on (rbac.org_module_for) - org admins never
    hold it, so it only ever lets in staff with that role.
    """

    message = "Your organization does not have access to this module."

    def has_permission(self, request, view):
        required_modules = getattr(view, "required_any_module", None)
        if not required_modules:
            return True
        if getattr(request, "is_super_admin", False):
            return True
        organization_id = getattr(request, "organization_id", None)
        if not organization_id:
            return False
        is_org_admin = getattr(request, "is_org_admin", False)
        user_modules = getattr(request, "modules", None) or []
        by_pages = getattr(request, "page_permissions", None) is not None
        for module in required_modules:
            org_ok = OrganizationModule.objects.filter(
                organization_id=organization_id,
                module=org_module_for(module),
                is_enabled=True,
            ).exists()
            if not org_ok:
                continue
            if is_org_admin:
                return True
            if by_pages:
                # Staff: their pages decide (any enabled module will do).
                return page_allowed(request, view, required_modules)
            if module in user_modules:
                return True
        return False
