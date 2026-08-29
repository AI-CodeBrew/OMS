import re
import time

import requests


class ShopifyAPIError(Exception):
    pass


def _base_url(shop_domain, api_version):
    return f"https://{shop_domain}/admin/api/{api_version}"


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
    resp = requests.put(url, json=payload, headers=headers, timeout=15)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to update tags on order {shopify_order_id}: {resp.status_code} {resp.text}")
    return resp.json()["order"]


def fetch_fulfillment_orders(shop_domain, access_token, api_version, shopify_order_id):
    url = f"{_base_url(shop_domain, api_version)}/orders/{shopify_order_id}/fulfillment_orders.json"
    resp = requests.get(url, headers={"X-Shopify-Access-Token": access_token}, timeout=15)
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
    resp = requests.post(url, json=payload, headers=headers, timeout=15)
    if not resp.ok:
        raise ShopifyAPIError(
            f"Failed to create fulfillment for {shopify_order_id}: {resp.status_code} {resp.text}"
        )
    return resp.json()["fulfillment"]


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
