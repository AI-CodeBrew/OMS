"""Every page a role can grant - one per sidebar item - and the rules that
turn a role (or an old-style staff login's modules) into page access.

This is the ONE list: the API serves it (GET /api/core/roles/ -> "pages")
for the Roles editor, the frontend sidebar items carry the same keys
(components/layout/moduleNav.js), and the API permission classes
(core/permissions.py) check requests against it.

Access levels: "read" (open the page, see data) or "write" (read + change
anything there). A page missing from a role means no access. Settings,
Integrations, Logs and Invoices stay store-admin only - no role grants them.
"""

READ = "read"
WRITE = "write"
LEVELS = (READ, WRITE)

# Module order = header tab order. "general" pages sit at the bottom of the
# sidebar and belong to no module tab.
MODULES = [
    {"key": "oms", "label": "OMS"},
    {"key": "ims", "label": "IMS"},
    {"key": "wms", "label": "WMS"},
    {"key": "finance", "label": "Financify"},
    {"key": "general", "label": "Other"},
]

PAGES = [
    {"key": "oms.dashboard", "module": "oms", "label": "Dashboard"},
    {"key": "oms.orders", "module": "oms", "label": "All Orders"},
    {"key": "oms.critical_orders", "module": "oms", "label": "Critical Orders"},
    {"key": "ims.inventory", "module": "ims", "label": "Inventory"},
    {"key": "ims.purchase_orders", "module": "ims", "label": "Purchase Orders"},
    {"key": "wms.packing", "module": "wms", "label": "Packing"},
    {"key": "wms.returns_desk", "module": "wms", "label": "Returns Desk"},
    {"key": "finance.home", "module": "finance", "label": "Financify"},
    {"key": "reports", "module": "general", "label": "Report"},
    {"key": "batch", "module": "general", "label": "Batch"},
    {"key": "tickets", "module": "general", "label": "Tickets"},
]

PAGE_KEYS = [p["key"] for p in PAGES]
_PAGE_MODULE = {p["key"]: p["module"] for p in PAGES}

# Which store modules a "general" page needs (any one of them) - Report
# and Batch are about orders and stock; Tickets is for everyone.
_GENERAL_NEEDS = {
    "reports": ("oms", "ims", "wms"),
    "batch": ("oms", "wms"),
    "tickets": (),
}

# Old-style staff logins (Membership.allowed_modules, before roles) and the
# pages each module meant - every one with write, as before.
LEGACY_MODULE_PAGES = {
    "oms": ["oms.dashboard", "oms.orders", "oms.critical_orders", "reports", "batch", "tickets"],
    "ims": ["ims.inventory", "ims.purchase_orders", "reports", "tickets"],
    "wms": ["wms.packing", "wms.returns_desk", "reports", "batch", "tickets"],
    "finance": ["finance.home", "tickets"],
    # Returns Associate: Returns Desk and Packing only.
    "returns": ["wms.returns_desk", "wms.packing", "tickets"],
}


def page_module(key):
    return _PAGE_MODULE.get(key)


def page_enabled(key, enabled_modules):
    """A page is only grantable while its store has the module it lives in."""
    module = _PAGE_MODULE.get(key)
    if module is None:
        return False
    if module == "general":
        needs = _GENERAL_NEEDS.get(key, ())
        return not needs or any(m in enabled_modules for m in needs)
    return module in enabled_modules


def clean_permissions(raw):
    """A role's permissions as sent by the Roles editor - unknown pages and
    levels dropped, "none" left out."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for key, level in raw.items():
        if key in _PAGE_MODULE and level in LEVELS:
            out[key] = level
    return out


def legacy_permissions(allowed_modules):
    """What an old-style staff login (modules, no role) could do."""
    out = {}
    for module in allowed_modules or []:
        for key in LEGACY_MODULE_PAGES.get(module, []):
            out[key] = WRITE
    return out


def effective_permissions(permissions, enabled_modules):
    """The pages a staff member can actually use right now: their grant,
    minus pages whose module the store has turned off."""
    return {k: v for k, v in (permissions or {}).items() if page_enabled(k, enabled_modules)}


def modules_for(permissions):
    """The store modules (header tabs) a set of pages opens - any page in a
    module, read or write. Ordered like the header."""
    have = {_PAGE_MODULE[k] for k in permissions or {} if k in _PAGE_MODULE}
    return [m["key"] for m in MODULES if m["key"] in have and m["key"] != "general"]


def allows(permissions, pages, need):
    """True if `permissions` gives `need` ("read"/"write") on ANY of `pages`
    - write includes read."""
    for key in pages:
        level = (permissions or {}).get(key)
        if level == WRITE or (level == READ and need == READ):
            return True
    return False


def pages_of_modules(modules):
    """Every page in the given store modules (a view gated only by module)."""
    wanted = set(modules or [])
    return [p["key"] for p in PAGES if p["module"] in wanted]
