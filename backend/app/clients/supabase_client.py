import os
from functools import lru_cache

from supabase import Client, create_client


# Table name constants
TABLE_PROFILES = "profiles"
TABLE_TENANTS = "tenants"
TABLE_ORDERS = "orders"
TABLE_ORDER_ITEMS = "order_items"
TABLE_WAREHOUSES = "warehouses"
TABLE_INVENTORY = "inventory"
TABLE_RETURNS = "returns"
TABLE_JOBS = "jobs"
TABLE_ADS_SPEND = "ads_spend"


class SupabaseClient:
    """Single shared Supabase wrapper. Prefer service role for backend writes."""

    def __init__(self, url=None, key=None):
        self.url = url or os.getenv("SUPABASE_URL")
        self.key = key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not self.url or not self.key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._client: Client = create_client(self.url, self.key)

    @property
    def client(self) -> Client:
        return self._client

    def table(self, name):
        return self._client.table(name)

    def from_(self, name):
        return self._client.from_(name)


@lru_cache(maxsize=1)
def get_supabase():
    return SupabaseClient()
