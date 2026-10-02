"""Turns a request's org scope - one store (the normal case) or several
(a super admin operating the Dispatch Hub, see middleware.py's
X-Dispatch-Hub handling) - into filter() kwargs, so views don't need an
if/else at every query site. TenantManager already does this same
switch internally for the implicit `.objects` queries; this is for the
handful of call sites in oms/views.py that filter explicitly."""


def org_filter(request):
    organization_ids = getattr(request, "organization_ids", None)
    if organization_ids:
        return {"organization_id__in": organization_ids}
    return {"organization_id": request.organization_id}


def is_hub_request(request):
    return bool(getattr(request, "organization_ids", None))
