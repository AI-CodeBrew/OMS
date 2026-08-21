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


def fetch_recent_orders(shop_domain, access_token, api_version, limit=50):
    url = f"{_base_url(shop_domain, api_version)}/orders.json"
    headers = {"X-Shopify-Access-Token": access_token}
    params = {"status": "any", "limit": limit, "order": "created_at desc"}
    resp = requests.get(url, headers=headers, params=params, timeout=20)
    if not resp.ok:
        raise ShopifyAPIError(f"Failed to fetch orders: {resp.status_code} {resp.text}")
    return resp.json().get("orders", [])
