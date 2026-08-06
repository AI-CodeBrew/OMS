import os


class ShopifyClient:
    """Shopify Admin API client. Per-tenant credentials passed at call time."""

    def __init__(self, shop_domain, access_token, api_version=None):
        self.shop_domain = shop_domain
        self.access_token = access_token
        self.api_version = api_version or os.getenv("SHOPIFY_API_VERSION", "2024-10")

    def _base_url(self):
        return f"https://{self.shop_domain}/admin/api/{self.api_version}"

    # Methods added when integrations module is implemented
