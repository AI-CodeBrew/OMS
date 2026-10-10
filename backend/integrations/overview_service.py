"""Super admin's cross-store view of every integration: one row per store,
one cell per integration (Shopify, Smartlane, OMS Courier, BarqRaftar,
PostEx). Read-only - managing a connection still happens by opening the
store and using its own integration page, so there is exactly one code
path that connects, edits or disconnects anything.

One query per integration for the whole platform rather than one per
store, so the page stays fast as the store count grows. Never returns
credentials, only whether a connection is live and what identifies it.
"""

from core.models import Organization
from core.platform_service import get_platform_organization

from .barqraftar.models import BarqRaftarConnection
from .business_services import _is_live
from .models import (
    ShopifyConnection,
    SmartlaneBusinessConfig,
    SmartlaneConnection,
    SmartlaneRequest,
    SmartlaneStoreLink,
)
from .postex.models import PostExConnection


def _iso(value):
    return value.isoformat() if value else None


def _latest(*values):
    present = [v for v in values if v]
    return max(present) if present else None


def _by_org(queryset):
    """Newest row per organization - the shape every integration below
    shares (Shopify can technically hold several rows for one org)."""
    rows = {}
    for row in queryset.order_by("updated_at"):
        rows[row.organization_id] = row
    return rows


def _shopify(conn):
    if conn is None:
        return None
    return {
        "connected": conn.is_connected,
        "label": conn.shop_domain,
        "last_activity_at": _iso(conn.last_synced_at),
    }


def _smartlane(conn):
    if conn is None:
        return None
    return {
        "connected": conn.is_connected,
        "label": (
            f"Warehouse {conn.store_warehouse_code}" if conn.store_warehouse_code else ""
        ),
        "last_activity_at": _iso(conn.last_event_at),
    }


def _oms_courier(link, conn):
    if link is None and conn is None:
        return None
    return {
        "connected": _is_live(link, conn),
        "status": link.status if link else "",
        "label": link.get_status_display() if link else "",
        "last_activity_at": _iso(conn.last_event_at if conn else None),
    }


def _barqraftar(conn):
    if conn is None:
        return None
    return {
        "connected": conn.is_connected,
        "label": (
            f"Account {conn.account_number}" if conn.account_number else conn.pickup_address_label
        ),
        "last_activity_at": _iso(conn.last_event_at),
    }


def _postex(conn):
    if conn is None:
        return None
    return {
        "connected": conn.is_connected,
        "label": conn.merchant_name or conn.pickup_address_label,
        "last_activity_at": _iso(_latest(conn.last_synced_at, conn.last_event_at)),
        "error": conn.last_webhook_error,
    }


def list_store_integrations():
    orgs = (
        Organization.objects.filter(is_platform=False)
        .prefetch_related("modules")
        .order_by("name")
    )

    shopify = _by_org(ShopifyConnection.all_objects.all())
    smartlane = _by_org(
        SmartlaneConnection.all_objects.filter(kind=SmartlaneConnection.KIND_OWN)
    )
    oms_conn = _by_org(
        SmartlaneConnection.all_objects.filter(kind=SmartlaneConnection.KIND_OMS)
    )
    oms_link = _by_org(SmartlaneStoreLink.all_objects.all())
    barqraftar = _by_org(BarqRaftarConnection.all_objects.all())
    postex = _by_org(PostExConnection.all_objects.all())

    stores = []
    for org in orgs:
        stores.append(
            {
                "id": str(org.id),
                "name": org.name,
                "slug": org.slug,
                "is_active": org.is_active,
                "is_manual_store": org.is_manual_store,
                "modules": [m.module for m in org.modules.all() if m.is_enabled],
                "integrations": {
                    "shopify": _shopify(shopify.get(org.id)),
                    "smartlane": _smartlane(smartlane.get(org.id)),
                    "oms_courier": _oms_courier(oms_link.get(org.id), oms_conn.get(org.id)),
                    "barq_raftar": _barqraftar(barqraftar.get(org.id)),
                    "postex": _postex(postex.get(org.id)),
                },
            }
        )
    return stores


def oms_courier_summary():
    """The super admin's OMS Courier tab: FynkTech's own accounts, which
    live on the hidden platform org (core.platform_service), in the same
    per-integration shape as list_store_integrations - plus how the
    Smartlane Business console (per-store OMS Courier onboarding) stands."""
    org = get_platform_organization()
    config = SmartlaneBusinessConfig.load()
    pending = (
        SmartlaneStoreLink.all_objects.filter(status__in=["pending_approval", "in_review"]).count()
        + SmartlaneRequest.all_objects.filter(status="pending_approval").count()
    )
    return {
        "organization": {"id": str(org.id), "name": org.name},
        "accounts": {
            "smartlane": _smartlane(
                SmartlaneConnection.all_objects.filter(
                    organization_id=org.id, kind=SmartlaneConnection.KIND_OWN
                ).first()
            ),
            "barq_raftar": _barqraftar(
                BarqRaftarConnection.all_objects.filter(organization_id=org.id).first()
            ),
            "postex": _postex(PostExConnection.all_objects.filter(organization_id=org.id).first()),
        },
        "smartlane_business": {
            "configured": config.is_configured,
            "active": config.is_active,
            "pending_requests": pending,
        },
    }
