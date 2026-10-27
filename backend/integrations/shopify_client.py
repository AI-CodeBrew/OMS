import contextvars
import re
import time
from contextlib import contextmanager

import requests


class ShopifyAPIError(Exception):
    pass


def _base_url(shop_domain, api_version):
    return f"https://{shop_domain}/admin/api/{api_version}"


# Set inside wait_out_rate_limits(). The status-push writes below normally
# fail fast on a 429 - they run inside the request that moved the order, and
# a bulk action over many orders must not stall on Shopify's ~2 requests/
# second - but a push meant to cover every order should wait its turn.
_wait_out_rate_limits = contextvars.ContextVar("shopify_wait_out_rate_limits", default=False)


@contextmanager
def wait_out_rate_limits():
    token = _wait_out_rate_limits.set(True)
    try:
        yield
    finally:
        _wait_out_rate_limits.reset(token)


def _send(method, url, **kwargs):
    """requests.request for the status-push writes: one try, or - inside
    wait_out_rate_limits() - waiting out Shopify's 429s (Retry-After) the
    way _get_with_backoff does for the order scans."""
    tries = 5 if _wait_out_rate_limits.get() else 1
    for attempt in range(tries):
        resp = requests.request(method, url, timeout=15, **kwargs)
        if resp.status_code != 429 or attempt == tries - 1:
            return resp
        time.sleep(float(resp.headers.get("Retry-After", 2)))
    return resp


def fetch_shop_info(shop_domain, access_token, api_version):
    url = f"{_base_url(shop_domain, api_version)}/shop.json"
    resp = requests.get(url, headers={"X-Shopify-Access-Token": access_token}, timeout=15)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch shop info: {resp.status_code} {resp.text}")
    return resp.json()["shop"]


def register_webhook(shop_domain, access_token, api_version, topic, address):
    url = f"{_base_url(shop_domain, api_version)}/webhooks.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {"webhook": {"topic": topic, "address": address, "format": "json"}}
    resp = requests.post(url, json=payload, headers=headers, timeout=15)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to register webhook {topic}: {resp.status_code} {resp.text}")
    return resp.json()["webhook"]


def list_webhooks(shop_domain, access_token, api_version):
    """Every webhook currently registered against this shop, across every
    app - used to check for an existing (topic, address) pair before
    registering, since Shopify 422s a repeat registration of the same pair
    ("address ... has already been taken") rather than treating it as a
    no-op."""
    url = f"{_base_url(shop_domain, api_version)}/webhooks.json"
    resp = requests.get(
        url, headers={"X-Shopify-Access-Token": access_token}, params={"limit": 250}, timeout=15
    )
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to list webhooks: {resp.status_code} {resp.text}")
    return resp.json().get("webhooks", [])


def unregister_webhook(shop_domain, access_token, api_version, webhook_id):
    url = f"{_base_url(shop_domain, api_version)}/webhooks/{webhook_id}.json"
    resp = requests.delete(url, headers={"X-Shopify-Access-Token": access_token}, timeout=15)
    # 404 means it's already gone (e.g. deleted from the Shopify side) -
    # that still counts as "successfully unregistered" for our purposes.
    if not resp.ok and resp.status_code != 404:
        raise ShopifyAPIError(f"Failed to unregister webhook {webhook_id}: {resp.status_code} {resp.text}")


def update_order_tags(shop_domain, access_token, api_version, shopify_order_id, tags):
    """Overwrites the order's tag list on Shopify. tags is the full desired
    set (comma-joined), not an addition - callers merge with whatever's
    already there themselves, same as the Shopify admin UI does."""
    url = f"{_base_url(shop_domain, api_version)}/orders/{shopify_order_id}.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {"order": {"id": shopify_order_id, "tags": tags}}
    resp = _send("PUT", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to update tags on order {shopify_order_id}: {resp.status_code} {resp.text}")
    return resp.json()["order"]


def fetch_order_tags(shop_domain, access_token, api_version, shopify_order_id):
    """The order's tags as Shopify has them right now (comma-joined) - read
    just before update_order_tags, which replaces the whole list, so the
    merchant's own tags (and other apps') survive it."""
    url = f"{_base_url(shop_domain, api_version)}/orders/{shopify_order_id}.json"
    resp = _send(
        "GET", url, headers={"X-Shopify-Access-Token": access_token}, params={"fields": "tags"}
    )
    if not resp.ok:
        raise ShopifyAPIError(
            f"Failed to read tags on order {shopify_order_id}: {resp.status_code} {resp.text}"
        )
    return (resp.json().get("order") or {}).get("tags") or ""


def fetch_fulfillment_orders(shop_domain, access_token, api_version, shopify_order_id):
    url = f"{_base_url(shop_domain, api_version)}/orders/{shopify_order_id}/fulfillment_orders.json"
    resp = _send("GET", url, headers={"X-Shopify-Access-Token": access_token})
    if not resp.ok:
        raise ShopifyAPIError(
            f"Failed to fetch fulfillment orders for {shopify_order_id}: {resp.status_code} {resp.text}"
        )
    return resp.json().get("fulfillment_orders", [])


def create_fulfillment(
    shop_domain, access_token, api_version, shopify_order_id, *, tracking_number, tracking_company="", notify_customer=False
):
    """Marks the order fulfilled on Shopify with our tracking number, using
    the fulfillment-orders flow (the orders/{id}/fulfillments.json shortcut
    is deprecated on current API versions). Only the still-open fulfillment
    orders are fulfilled - a partially/already-fulfilled order shouldn't be
    re-submitted for its already-closed line items."""
    fulfillment_orders = fetch_fulfillment_orders(shop_domain, access_token, api_version, shopify_order_id)
    open_orders = [fo for fo in fulfillment_orders if fo.get("status") in ("open", "in_progress")]
    if not open_orders:
        raise ShopifyAPIError(f"No open fulfillment orders for {shopify_order_id} - already fulfilled?")

    url = f"{_base_url(shop_domain, api_version)}/fulfillments.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {
        "fulfillment": {
            "line_items_by_fulfillment_order": [
                {"fulfillment_order_id": fo["id"]} for fo in open_orders
            ],
            "tracking_info": {"number": tracking_number, "company": tracking_company},
            "notify_customer": notify_customer,
        }
    }
    resp = _send("POST", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(
            f"Failed to create fulfillment for {shopify_order_id}: {resp.status_code} {resp.text}"
        )
    return resp.json()["fulfillment"]


def create_fulfillment_event(shop_domain, access_token, api_version, shopify_order_id, fulfillment_id, status):
    """Advances Shopify's own "Delivery status" timeline on an existing
    fulfillment - separate from create_fulfillment above, which only marks
    the order fulfilled in the first place. `status` must be one of
    Shopify's fixed shipment_status values (confirmed, in_transit,
    out_for_delivery, delivered, attempted_delivery, failure, ...) - see
    integrations.services._SHOPIFY_SHIPMENT_STATUS for the OMS mapping."""
    url = (
        f"{_base_url(shop_domain, api_version)}/orders/{shopify_order_id}"
        f"/fulfillments/{fulfillment_id}/events.json"
    )
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {"event": {"status": status}}
    resp = _send("POST", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(
            f"Failed to post fulfillment event ({status}) for order {shopify_order_id}: "
            f"{resp.status_code} {resp.text}"
        )
    return resp.json()["fulfillment_event"]


def fetch_order_count(shop_domain, access_token, api_version, *, created_at_min=None, created_at_max=None):
    url = f"{_base_url(shop_domain, api_version)}/orders/count.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"status": "any"}
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max

    # Gap detection calls this in a loop (one request per month), which is
    # exactly the pattern that trips Shopify's ~2 req/sec limit - so this
    # backs off on 429 the same way iter_order_pages does rather than
    # failing the whole scan on one throttled request.
    for _attempt in range(5):
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 429:
            break
        time.sleep(float(resp.headers.get("Retry-After", 2)))
    else:
        raise ShopifyAPIError("Failed to fetch order count: rate limited repeatedly by Shopify")

    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch order count: {resp.status_code} {resp.text}")
    return resp.json().get("count", 0)


def fetch_earliest_order_date(shop_domain, access_token, api_version):
    """created_at of the oldest order in the store, or None if empty.

    Gap detection needs a real lower bound to scan from - starting at the
    oldest order we happen to hold locally would structurally miss any
    window older than our first successful sync.
    """
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"status": "any", "limit": 1, "order": "created_at asc"}
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch earliest order: {resp.status_code} {resp.text}")
    orders = resp.json().get("orders", [])
    return orders[0].get("created_at") if orders else None


_NEXT_PAGE_INFO_RE = re.compile(r'<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"')


def _get_with_backoff(url, headers, params):
    """Shared 429-aware GET. Shopify allows ~2 requests/second; a long
    backfill scan will hit that, and one throttled response should pause
    rather than abort the run."""
    for _attempt in range(5):
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code != 429:
            return resp
        time.sleep(float(resp.headers.get("Retry-After", 2)))
    raise ShopifyAPIError("Rate limited repeatedly by Shopify")


def iter_order_ids(
    shop_domain,
    access_token,
    api_version,
    *,
    created_at_min=None,
    created_at_max=None,
    page_size=250,
    max_pages=200,
):
    """Yields lists of order ids only, via Shopify's `fields` parameter.

    Used to work out which orders in a window we're actually missing
    before fetching anything heavy: a date range that's short by 9 orders
    usually still holds hundreds we already have, and re-pulling those
    whole payloads is the bulk of a needlessly slow backfill.
    """
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"status": "any", "limit": page_size, "order": "created_at asc", "fields": "id"}
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max

    page_info = None
    for _ in range(max_pages):
        query = (
            {"limit": page_size, "page_info": page_info, "fields": "id"} if page_info else params
        )
        resp = _get_with_backoff(url, headers, query)
        if not resp.ok:
            raise ShopifyAPIError(f"Failed to fetch order ids: {resp.status_code} {resp.text}")

        yield [o["id"] for o in resp.json().get("orders", [])]

        match = _NEXT_PAGE_INFO_RE.search(resp.headers.get("Link", ""))
        if not match:
            break
        page_info = match.group(1)


def fetch_orders_by_ids(shop_domain, access_token, api_version, ids):
    """Fetches full payloads for specific order ids (max 250 per call)."""
    if not ids:
        return []
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {
        "ids": ",".join(str(i) for i in ids),
        "status": "any",
        "limit": len(ids),
    }
    resp = _get_with_backoff(url, headers, params)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch orders by id: {resp.status_code} {resp.text}")
    return resp.json().get("orders", [])


def iter_order_pages(
    shop_domain,
    access_token,
    api_version,
    *,
    created_at_min=None,
    created_at_max=None,
    page_size=250,
    max_pages=40,
):
    """Paginates through /orders.json via Shopify's cursor-based (Link
    header) pagination, since the REST API caps a single page at 250 and
    the older `page` query param is deprecated for this API version.
    Yields each page's order list as it arrives (rather than collecting
    everything into one list) so a caller syncing thousands of orders can
    report progress and persist incrementally instead of holding the
    entire pull in memory until the very end.

    created_at_min/created_at_max (ISO datetime strings, optional): bound
    the pull to a custom date range (e.g. "previous month" or a picked
    from/to range) - used for incremental "new orders" syncs (min only)
    and custom-range syncs (both). Omit both for a full historical pull.

    max_pages is a safety valve (40 * 250 = 10,000 orders) against a
    runaway loop on an enormous store, not a deliberate cap on "recent"
    orders - unlike the old fixed limit=50, this is meant to return
    everything for any realistically-sized store.
    """
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"status": "any", "limit": page_size, "order": "created_at asc"}
    if created_at_min:
        params["created_at_min"] = created_at_min
    if created_at_max:
        params["created_at_max"] = created_at_max

    page_info = None
    for _ in range(max_pages):
        # Shopify's cursor pagination rejects filter params (status/order/
        # created_at_min) on any request that already carries page_info -
        # only limit + page_info are allowed past the first page.
        query = {"limit": page_size, "page_info": page_info} if page_info else params

        # Shopify's REST Admin API allows ~2 requests/second - a full
        # historical pull over many pages will hit that limit and get a
        # 429 back. Respect Retry-After and back off instead of aborting
        # the whole sync partway through.
        for attempt in range(5):
            resp = requests.get(url, headers=headers, params=query, timeout=30)
            if resp.status_code != 429:
                break
            time.sleep(float(resp.headers.get("Retry-After", 2)))
        else:
            raise ShopifyAPIError("Failed to fetch orders: rate limited repeatedly by Shopify")

        if not resp.ok:
            raise ShopifyAPIError(f"Failed to fetch orders: {resp.status_code} {resp.text}")

        yield resp.json().get("orders", [])

        match = _NEXT_PAGE_INFO_RE.search(resp.headers.get("Link", ""))
        if not match:
            break
        page_info = match.group(1)


def fetch_locations(shop_domain, access_token, api_version):
    """All of the store's fulfillment locations - inventory_levels below
    is scoped per location, so this is needed to know what to ask for."""
    url = f"{_base_url(shop_domain, api_version)}/locations.json"
    headers = {"X-Shopify-Access-Token": access_token}
    resp = _get_with_backoff(url, headers, {})
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch locations: {resp.status_code} {resp.text}")
    return resp.json().get("locations", [])


def iter_variant_skus(shop_domain, access_token, api_version, *, page_size=250, max_pages=400):
    """Yields (sku, inventory_item_id, product_name) for every variant in
    the whole product catalogue - sku may be "" for variants that don't
    have one set, they're still yielded rather than skipped, since
    inventory_item_id (not sku) is the real join key.

    inventory_item_id is what actually links a variant to its stock
    levels (inventory_levels below is keyed by that, not by SKU or
    product id), so this is the step that makes the SKU-to-quantity
    mapping possible at all.
    """
    url = f"{_base_url(shop_domain, api_version)}/products.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"fields": "title,variants", "limit": page_size}

    page_info = None
    for _ in range(max_pages):
        query = {"limit": page_size, "page_info": page_info} if page_info else params
        resp = _get_with_backoff(url, headers, query)
        if not resp.ok:
            raise ShopifyAPIError(f"Failed to fetch products: {resp.status_code} {resp.text}")

        for product in resp.json().get("products", []):
            title = (product.get("title") or "").strip()
            for variant in product.get("variants", []):
                sku = (variant.get("sku") or "").strip()
                variant_title = (variant.get("title") or "").strip()
                name = title if variant_title in ("", "Default Title") else f"{title} - {variant_title}"
                yield sku, variant.get("inventory_item_id"), name

        match = _NEXT_PAGE_INFO_RE.search(resp.headers.get("Link", ""))
        if not match:
            break
        page_info = match.group(1)


def fetch_inventory_levels(shop_domain, access_token, api_version, inventory_item_ids, *, location_ids=None):
    """Available quantity per (inventory_item_id, location) - Shopify caps
    inventory_item_ids at 100 per call, so callers with more than that
    must batch (see integrations.services.sync_inventory_from_shopify)."""
    if not inventory_item_ids:
        return []
    url = f"{_base_url(shop_domain, api_version)}/inventory_levels.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {
        "inventory_item_ids": ",".join(str(i) for i in inventory_item_ids),
        "limit": 250,
    }
    if location_ids:
        params["location_ids"] = ",".join(str(i) for i in location_ids)
    resp = _get_with_backoff(url, headers, params)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch inventory levels: {resp.status_code} {resp.text}")
    return resp.json().get("inventory_levels", [])


# --- Outbound catalogue/stock writes (WMS "Push to Shopify") ---

_INVENTORY_ITEM_QUERY = """
query($id: ID!) {
  inventoryItem(id: $id) {
    id
    variant {
      id
      title
      product { id title hasOnlyDefaultVariant }
    }
    inventoryLevels(first: 50) {
      edges { node { location { id } quantities(names: ["available"]) { quantity } } }
    }
  }
}
"""


def _gid_to_id(gid):
    return int(str(gid).rsplit("/", 1)[-1]) if gid else None


def fetch_inventory_item_context(shop_domain, access_token, api_version, inventory_item_id):
    """The variant/product an inventory item belongs to, plus its
    available count per location - everything a push needs to address
    the right product and location. GraphQL rather than REST because REST
    has no route from an inventory item back to its variant/product, and
    StockItem only stores the inventory item id. Returns None if Shopify
    no longer has the item (variant deleted)."""
    url = f"{_base_url(shop_domain, api_version)}/graphql.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {
        "query": _INVENTORY_ITEM_QUERY,
        "variables": {"id": f"gid://shopify/InventoryItem/{inventory_item_id}"},
    }
    resp = _send("POST", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to look up inventory item {inventory_item_id}: {resp.status_code} {resp.text}")
    body = resp.json()
    if body.get("errors"):
        raise ShopifyAPIError(f"Failed to look up inventory item {inventory_item_id}: {body['errors']}")
    item = (body.get("data") or {}).get("inventoryItem")
    if not item or not item.get("variant"):
        return None
    variant = item["variant"]
    product = variant.get("product") or {}
    levels = []
    for edge in (item.get("inventoryLevels") or {}).get("edges", []):
        node = edge.get("node") or {}
        quantities = node.get("quantities") or []
        levels.append({
            "location_id": _gid_to_id((node.get("location") or {}).get("id")),
            "available": quantities[0].get("quantity") if quantities else 0,
        })
    return {
        "variant_id": _gid_to_id(variant.get("id")),
        "variant_title": (variant.get("title") or "").strip(),
        "product_id": _gid_to_id(product.get("id")),
        "product_title": (product.get("title") or "").strip(),
        "has_only_default_variant": bool(product.get("hasOnlyDefaultVariant")),
        "levels": levels,
    }


def update_product_title(shop_domain, access_token, api_version, product_id, title):
    url = f"{_base_url(shop_domain, api_version)}/products/{product_id}.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {"product": {"id": product_id, "title": title}}
    resp = _send("PUT", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to update product title: {resp.status_code} {resp.text}")
    return resp.json()["product"]


def adjust_inventory_level(shop_domain, access_token, api_version, *, inventory_item_id, location_id, adjustment):
    """Relative change (+/-) to one location's available count. Relative
    on purpose: an absolute set would overwrite whatever Shopify changed
    meanwhile (its own orders deduct as they're placed)."""
    url = f"{_base_url(shop_domain, api_version)}/inventory_levels/adjust.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    payload = {
        "location_id": location_id,
        "inventory_item_id": inventory_item_id,
        "available_adjustment": adjustment,
    }
    resp = _send("POST", url, json=payload, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to adjust inventory: {resp.status_code} {resp.text}")
    return resp.json()["inventory_level"]


# --- Creating a product from WMS ("Add Stock Item" -> also on Shopify) ---


def graphql(shop_domain, access_token, api_version, query, variables=None):
    """One Admin GraphQL call. Raises on transport errors, top-level
    `errors`, and - for the mutations below - their `userErrors`."""
    url = f"{_base_url(shop_domain, api_version)}/graphql.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    resp = _send("POST", url, json={"query": query, "variables": variables or {}}, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Shopify GraphQL call failed: {resp.status_code} {resp.text[:300]}")
    body = resp.json()
    if body.get("errors"):
        raise ShopifyAPIError(f"Shopify GraphQL error: {body['errors']}")
    return body.get("data") or {}


def _raise_user_errors(payload, what):
    errors = (payload or {}).get("userErrors") or []
    if errors:
        raise ShopifyAPIError(f"{what}: " + "; ".join(e.get("message", "") for e in errors))


def find_variant_by_sku(shop_domain, access_token, api_version, sku):
    """The first variant on the store with exactly this SKU, or None.
    Shopify doesn't enforce unique SKUs, but orders find stock by SKU, so
    a second product with the same one would split its stock."""
    data = graphql(
        shop_domain, access_token, api_version,
        """query($q: String!) {
          productVariants(first: 5, query: $q) { nodes { sku product { title } } }
        }""",
        {"q": f'sku:"{sku}"'},
    )
    for node in (data.get("productVariants") or {}).get("nodes", []):
        if (node.get("sku") or "") == sku:
            return {"product_title": (node.get("product") or {}).get("title", "")}
    return None


def find_variant_id_by_sku(shop_domain, access_token, api_version, sku):
    """The numeric id of the variant with exactly this SKU, or None - what
    a REST order line item needs to be the real product (its stock goes
    down on Shopify) rather than a free-text one."""
    data = graphql(
        shop_domain, access_token, api_version,
        """query($q: String!) {
          productVariants(first: 5, query: $q) { nodes { sku legacyResourceId } }
        }""",
        {"q": f'sku:"{sku}"'},
    )
    for node in (data.get("productVariants") or {}).get("nodes", []):
        if (node.get("sku") or "") == sku:
            return int(node["legacyResourceId"])
    return None


def create_order(shop_domain, access_token, api_version, order):
    """POST /orders.json - Shopify gives it the store's next order number.
    Returns the created order in the same REST shape the order webhook and
    sync deliver, so it can go straight through upsert_order_from_shopify."""
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token, "Content-Type": "application/json"}
    resp = _send("POST", url, json={"order": order}, headers=headers)
    if not resp.ok:
        raise ShopifyAPIError(f"Shopify refused the order: {resp.status_code} {resp.text[:400]}")
    return resp.json()["order"]


def upload_product_image(shop_domain, access_token, api_version, *, filename, content_type, content):
    """Uploads one image to Shopify's staging storage and returns the
    resourceUrl productCreate's media takes as originalSource - the
    GraphQL replacement for REST's base64 `attachment`."""
    data = graphql(
        shop_domain, access_token, api_version,
        """mutation($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }""",
        {"input": [{
            "resource": "IMAGE",
            "filename": filename,
            "mimeType": content_type,
            "fileSize": str(len(content)),
            "httpMethod": "POST",
        }]},
    )
    payload = data.get("stagedUploadsCreate")
    _raise_user_errors(payload, f"Could not start uploading {filename}")
    target = payload["stagedTargets"][0]
    form = {p["name"]: p["value"] for p in target["parameters"]}
    resp = requests.post(target["url"], data=form, files={"file": (filename, content, content_type)}, timeout=60)
    if not resp.ok:
        raise ShopifyAPIError(f"Could not upload {filename}: {resp.status_code}")
    return target["resourceUrl"]


def create_product(shop_domain, access_token, api_version, *, title, sku, price, image_sources=()):
    """Creates an active single-variant product with this SKU and price,
    inventory tracked, plus any already-uploaded images. Returns
    {product_id, inventory_item_id} as plain integers."""
    args = (shop_domain, access_token, api_version)
    data = graphql(
        *args,
        """mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
          productCreate(product: $product, media: $media) {
            product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
            userErrors { field message }
          }
        }""",
        {
            "product": {"title": title, "status": "ACTIVE"},
            "media": [{"originalSource": src, "mediaContentType": "IMAGE", "alt": title} for src in image_sources],
        },
    )
    payload = data.get("productCreate")
    _raise_user_errors(payload, "Shopify refused the product")
    product = payload["product"]
    variant = product["variants"]["nodes"][0]

    data = graphql(
        *args,
        """mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }""",
        {
            "productId": product["id"],
            "variants": [{
                "id": variant["id"],
                "price": str(price),
                "inventoryItem": {"sku": sku, "tracked": True},
            }],
        },
    )
    _raise_user_errors(data.get("productVariantsBulkUpdate"), "Product created, but its SKU/price were refused")
    return {
        "product_id": _gid_to_id(product["id"]),
        "inventory_item_id": _gid_to_id(variant["inventoryItem"]["id"]),
    }


def activate_inventory_at_location(shop_domain, access_token, api_version, *, inventory_item_id, location_id):
    """Makes sure the item is stocked at this location (a no-op if it
    already is), so a following adjust_inventory_level has a level to
    change."""
    data = graphql(
        shop_domain, access_token, api_version,
        """mutation($itemId: ID!, $locationId: ID!) {
          inventoryActivate(inventoryItemId: $itemId, locationId: $locationId) {
            inventoryLevel { id }
            userErrors { field message }
          }
        }""",
        {
            "itemId": f"gid://shopify/InventoryItem/{inventory_item_id}",
            "locationId": f"gid://shopify/Location/{location_id}",
        },
    )
    _raise_user_errors(data.get("inventoryActivate"), "Could not stock the product at the shop's location")


def iter_variant_images(shop_domain, access_token, api_version, *, page_size=250, max_pages=400):
    """Yields (inventory_item_id, sku, image_url) for every variant - the
    variant's own image when it has one, else the product's first image
    ("" when the product has none)."""
    url = f"{_base_url(shop_domain, api_version)}/products.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"fields": "variants,images,image", "limit": page_size}

    page_info = None
    for _ in range(max_pages):
        query = {"limit": page_size, "page_info": page_info} if page_info else params
        resp = _get_with_backoff(url, headers, query)
        if not resp.ok:
            raise ShopifyAPIError(f"Failed to fetch products: {resp.status_code} {resp.text}")

        for product in resp.json().get("products", []):
            images = product.get("images") or []
            by_id = {img.get("id"): img.get("src") or "" for img in images}
            first = (product.get("image") or {}).get("src") or (images[0].get("src") if images else "") or ""
            for variant in product.get("variants", []):
                src = by_id.get(variant.get("image_id")) or first
                yield variant.get("inventory_item_id"), (variant.get("sku") or "").strip(), src

        match = _NEXT_PAGE_INFO_RE.search(resp.headers.get("Link", ""))
        if not match:
            break
        page_info = match.group(1)
