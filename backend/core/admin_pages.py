"""The super admin side's pages, and which of them a limited super admin
login (core.models.AdminStaff) may use.

A super admin login is either an OWNER (no AdminStaff row - everything,
including Admin Team) or STAFF (an AdminStaff row - only the pages its role
or own permissions give, each "read" or "write"; a page left out = none).

Enforced for every request in core.middleware via `page_for_request`:
- /api/core/admin/... calls by their path;
- operating stores from the panel - Dispatch Hub, All Orders, opening a
  store ("act as") or the OMS Courier accounts - by the header that says so.
GET/HEAD/OPTIONS need read; anything else needs write. The same keys are
the sidebar items in frontend app/(super-admin)/layout.jsx.
"""

READ = "read"
WRITE = "write"
LEVELS = (READ, WRITE)

PAGES = [
    {"key": "organizations", "label": "Organizations", "hint": "Organizations, their stores, admins and logins"},
    {"key": "stores", "label": "Stores", "hint": "Stores list, service model, open a store"},
    {"key": "all_orders", "label": "All Orders", "hint": "Every store's orders"},
    {"key": "critical_orders", "label": "Critical Orders", "hint": "Every store's critical orders, in one place"},
    # The Dispatch Hub group: its own management page, then each page
    # inside the Hub (HUB_PAGES below).
    {"key": "dispatch_hub", "label": "Hub stores & rates",
     "hint": "The Dispatch Hub page itself - which stores are in it, their rates", "group": "hub"},
    # Pages INSIDE the Dispatch Hub, one by one (HUB_PAGES below).
    {"key": "hub.dashboard", "label": "Dispatch Hub · Dashboard", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.orders", "label": "Dispatch Hub · All Orders", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.critical_orders", "label": "Dispatch Hub · Critical Orders", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.returns_desk", "label": "Dispatch Hub · Returns Desk", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.batch", "label": "Dispatch Hub · Batch", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.reports", "label": "Dispatch Hub · Report", "hint": "Inside the Hub", "group": "hub"},
    {"key": "hub.tickets", "label": "Dispatch Hub · Tickets", "hint": "Inside the Hub", "group": "hub"},
    {"key": "inventory", "label": "Inventory", "hint": "Every store's inventory"},
    {"key": "invoices", "label": "Invoices", "hint": "Store invoices"},
    {"key": "integrations", "label": "Integrations", "hint": "Every store's integrations"},
    {"key": "oms_courier", "label": "OMS Couriers", "hint": "FynkTech's courier accounts, Smartlane and requests"},
    {"key": "logs", "label": "Logs", "hint": "Activity and order logs"},
    {"key": "tickets", "label": "Tickets", "hint": "Store tickets"},
    {"key": "cities", "label": "Cities", "hint": "The city list"},
]
PAGE_KEYS = [p["key"] for p in PAGES]

# Each page inside the Dispatch Hub -> the store page (core.pages) it is.
# Inside the Hub a staff login is limited like a store's staff: the Hub's
# own screens and APIs already check those store pages.
HUB_PAGES = {
    "hub.dashboard": "oms.dashboard",
    "hub.orders": "oms.orders",
    "hub.critical_orders": "oms.critical_orders",
    "hub.returns_desk": "wms.returns_desk",
    "hub.batch": "batch",
    "hub.reports": "reports",
    "hub.tickets": "tickets",
}
HUB_KEYS = tuple(HUB_PAGES)


def hub_store_permissions(permissions):
    """The store pages (core.pages keys) a staff login may use inside the
    Dispatch Hub - one for each Hub page it has, at the same level."""
    permissions = permissions or {}
    return {store_key: permissions[hub_key] for hub_key, store_key in HUB_PAGES.items() if permissions.get(hub_key)}

# Admin Team (logins and roles of the super admin side) is owner-only:
# a staff login that could edit roles could give itself everything.
OWNER_ONLY_PREFIXES = ("/api/core/admin/team/", "/api/core/admin/roles/")

# /api/core/admin/<prefix> -> pages, any one of which allows the call.
_ADMIN_PATHS = [
    ("organizations/", ("organizations",)),
    ("users/", ("organizations",)),
    # The Stores page adds/removes Hub stores as well.
    ("dispatch-hub/", ("dispatch_hub", "stores")),
    ("activity-logs/", ("logs",)),
    ("order-logs/", ("logs",)),
    ("smartlane/", ("oms_courier",)),
    ("oms-courier/", ("oms_courier",)),
    ("integrations/", ("integrations",)),
    ("tickets/", ("tickets",)),
    ("cities/", ("cities",)),
    ("inventory/", ("inventory",)),
    ("invoices/", ("invoices",)),
]
ADMIN_PREFIX = "/api/core/admin/"
# The organizations list feeds pickers on several pages (Stores, Hub,
# Invoices) - any staff login may read it.
SHARED_READ_PATHS = ("/api/core/admin/organizations/", "/api/core/admin/me/")


def clean_permissions(raw):
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, level in raw.items():
        if key in PAGE_KEYS and level in LEVELS:
            out[key] = level
    return out


def allows(permissions, pages, need):
    for key in pages:
        level = (permissions or {}).get(key)
        if level == WRITE or (level == READ and need == READ):
            return True
    return False


def page_for_request(path, *, act_as_platform=None, hub=None):
    """(pages, owner_only) for one request. pages None = nothing on the
    super admin side (e.g. a super admin reading its own session)."""
    if path.startswith(OWNER_ONLY_PREFIXES):
        return None, True
    if path.startswith(ADMIN_PREFIX):
        rest = path[len(ADMIN_PREFIX):]
        for prefix, pages in _ADMIN_PATHS:
            if rest.startswith(prefix):
                return pages, False
        return (), False  # an admin API not listed here: owners only
    if hub is not None:
        return (("all_orders", "critical_orders") if hub == "all" else ("dispatch_hub",)), False
    if act_as_platform is not None:
        return (("oms_courier",) if act_as_platform else ("stores", "integrations", "dispatch_hub")), False
    return None, False


def label(key):
    return next((p["label"] for p in PAGES if p["key"] == key), key)
