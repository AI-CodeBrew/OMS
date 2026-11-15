"""An organization with several stores.

Every store is still its own core.Organization - its own orders, Shopify,
couriers, Store ID and team. A store can be put *inside* another one
(Organization.parent), which makes the parent the organization's main
store and gives the group three things:

- the main store's org_admins can open every store of the group (an
  org_admin Membership in each - kept in step by sync_group_admins);
- staff can be given access to more than one store of the group
  (core.team_service.grant_store_access);
- ONE inventory: warehouses, stock, POs and suppliers all live under the
  main store, and every store's orders draw from it (wms.models'
  StockScopedManager, wms.services.stock_org_id).
"""

import logging
import time

from django.db import transaction

from .models import Membership, Organization, OrganizationModule

logger = logging.getLogger(__name__)


class OrgGroupError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# org id -> (root id, expires at). Store links change a handful of times a
# year, and every stock query asks, so a short cache saves a query per call.
_ROOT_CACHE = {}
_CACHE_SECONDS = 30


def clear_cache():
    _ROOT_CACHE.clear()


def root_id(organization_id):
    """The main store's id for any store of a group (the store's own id
    when it isn't inside another). None in, None out."""
    if not organization_id:
        return organization_id
    key = str(organization_id)
    hit = _ROOT_CACHE.get(key)
    now = time.monotonic()
    if hit and hit[1] > now:
        return hit[0]
    parent = Organization.objects.filter(id=key).values_list("parent_id", flat=True).first()
    result = str(parent) if parent else key
    _ROOT_CACHE[key] = (result, now + _CACHE_SECONDS)
    return result


def group_ids(organization_id):
    """Every store of the organization `organization_id` belongs to - the
    main store first. Just [it] for a store on its own."""
    root = root_id(organization_id)
    if not root:
        return []
    children = Organization.objects.filter(parent_id=root).order_by("name").values_list("id", flat=True)
    return [root, *(str(c) for c in children)]


def is_grouped(organization_id):
    """True when the store is a main store with stores inside it, or is
    inside one."""
    return len(group_ids(organization_id)) > 1


def group_stores(organization_id):
    """[{id, name, is_main}] for the store's whole group."""
    ids = group_ids(organization_id)
    names = {str(k): v for k, v in Organization.objects.filter(id__in=ids).values_list("id", "name")}
    return [{"id": i, "name": names.get(i, ""), "is_main": n == 0} for n, i in enumerate(ids)]


def sync_group_admins(root):
    """Every org_admin of the main store gets an org_admin Membership in
    each store of the group (with that store's enabled modules), so they
    see all of them in the store switcher. Never removes anything."""
    root = root if isinstance(root, Organization) else Organization.objects.get(id=root)
    admin_ids = list(
        Membership.objects.filter(organization=root, role="org_admin").values_list("user_id", flat=True)
    )
    added = 0
    for child in Organization.objects.filter(parent=root):
        modules = list(
            OrganizationModule.objects.filter(organization=child, is_enabled=True).values_list("module", flat=True)
        ) or ["oms"]
        for user_id in admin_ids:
            _, created = Membership.objects.get_or_create(
                organization=child,
                user_id=user_id,
                defaults={"role": "org_admin", "allowed_modules": modules},
            )
            added += int(created)
    return added


@transaction.atomic
def link_store(*, parent_id, store_id, actor_user_id=None, actor_email=""):
    """Puts store `store_id` inside organization `parent_id`. Its orders,
    Shopify, couriers and team are untouched; its inventory joins the
    organization's (wms.services.merge_store_inventory)."""
    from .rbac import write_audit_log

    if str(parent_id) == str(store_id):
        raise OrgGroupError("A store can't be put inside itself.")
    orgs = {str(o.id): o for o in Organization.objects.select_for_update().filter(id__in=[parent_id, store_id])}
    parent, store = orgs.get(str(parent_id)), orgs.get(str(store_id))
    if not parent or not store:
        raise OrgGroupError("Organization not found", 404)
    if parent.is_platform or store.is_platform:
        raise OrgGroupError("The OMS Courier account can't be part of an organization.")
    if parent.parent_id:
        raise OrgGroupError(f"{parent.name} is itself a store inside another organization - pick its main store.")
    if store.parent_id:
        raise OrgGroupError(f"{store.name} is already inside another organization - remove it from there first.")
    if Organization.objects.filter(parent=store).exists():
        raise OrgGroupError(f"{store.name} has stores of its own - it can't go inside another organization.")

    store.parent = parent
    store.save(update_fields=["parent", "updated_at"])
    clear_cache()

    from wms.services import merge_store_inventory

    merged = merge_store_inventory(parent_id=parent.id, store_id=store.id)
    admins = sync_group_admins(parent)

    for org in (parent, store):
        write_audit_log(
            organization_id=org.id,
            action="org.store_linked",
            summary=f"Store '{store.name}' added to organization '{parent.name}'",
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            metadata={"parent_id": str(parent.id), "store_id": str(store.id), "inventory": merged, "admins_added": admins},
        )
    return {"parent_id": str(parent.id), "store_id": str(store.id), "inventory": merged, "admins_added": admins}


@transaction.atomic
def unlink_store(*, store_id, actor_user_id=None, actor_email=""):
    """Takes a store out of its organization. The shared inventory stays
    with the main store (the store starts again with none of its own), and
    its Shopify links to that inventory are dropped. Memberships are kept -
    remove people from the Team page if they shouldn't keep access."""
    from .rbac import write_audit_log

    store = Organization.objects.select_for_update().filter(id=store_id).first()
    if not store:
        raise OrgGroupError("Organization not found", 404)
    if not store.parent_id:
        raise OrgGroupError(f"{store.name} isn't inside another organization.")
    parent = store.parent

    from wms.models import StockShopifyLink

    StockShopifyLink.all_objects.filter(store_id=store.id).delete()
    store.parent = None
    store.save(update_fields=["parent", "updated_at"])
    clear_cache()

    for org in (parent, store):
        write_audit_log(
            organization_id=org.id,
            action="org.store_unlinked",
            summary=f"Store '{store.name}' removed from organization '{parent.name}'",
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            metadata={"parent_id": str(parent.id), "store_id": str(store.id)},
        )
    return {"parent_id": str(parent.id), "store_id": str(store.id)}
