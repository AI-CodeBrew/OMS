"""Product name -> SKU when an order comes in (user, 2026-11-19).

Every way an order line is created (Shopify, a manual order, an edit, the
CSV import) passes its lines through `apply_skus`: a line whose product
name is exactly a name on the organization's list (oms.models.ProductSku)
gets that SKU - over whatever SKU Shopify sent, since the list is what the
organization's inventory is kept by. A name not on the list keeps its own
SKU (or none).

The list is organization level, like inventory: one store's order is
looked up in every store of its organization (core.org_group), its own
store's names first, so it works before and after stores are linked.

Each name also carries its pack units ("Pack of 2" = 2), saved on the
line as pack_units - stock moves by quantity x pack_units (wms.services);
the price is never touched.
"""

from core import org_group

from .models import ProductSku


def sku_map(organization_id, names):
    """{product name: (sku, units)} for `names` in the store's organization
    - the store's own rows win over another store's for the same name."""
    names = {n for n in names if n}
    if not organization_id or not names:
        return {}
    own = str(organization_id)
    stores = org_group.group_ids(organization_id) or [own]
    found = {}
    rows = ProductSku.all_objects.filter(organization_id__in=stores, product_name__in=names).values_list(
        "organization_id", "product_name", "sku", "units"
    )
    for org_id, name, sku, units in sorted(rows, key=lambda r: str(r[0]) != own):
        found.setdefault(name, (sku, max(units or 1, 1)))
    return found


def apply_skus(organization_id, items):
    """Sets the listed SKU and pack units on each line - OrderItem objects
    or item dicts (product_name / barcode / pack_units keys). Changes them
    in place; returns how many lines got a SKU from the list."""
    def name_of(item):
        return (item.get("product_name") if isinstance(item, dict) else item.product_name) or ""

    found = sku_map(organization_id, [name_of(i) for i in items])
    changed = 0
    for item in items:
        hit = found.get(name_of(item))
        if not hit:
            continue
        sku, units = hit
        if isinstance(item, dict):
            item["barcode"], item["pack_units"] = sku, units
        else:
            item.barcode, item.pack_units = sku, units
        changed += 1
    return changed


def apply_skus_by_store(items):
    """apply_skus for OrderItem objects of several stores at once (the CSV
    import's bulk insert)."""
    by_store = {}
    for item in items:
        by_store.setdefault(str(item.organization_id), []).append(item)
    return sum(apply_skus(org_id, store_items) for org_id, store_items in by_store.items())
