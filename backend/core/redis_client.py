"""Thin Redis helper shared by the order-view cache and the realtime
pub/sub layer (see core/realtime.py, core/consumers.py). One process-wide
connection pool, sized for a single gunicorn/daphne worker - see
settings.REDIS_URL for where the host comes from.

Caches the Orders tab payloads (counts + paginated lists) and the
Dashboard payload so a tab switch does not hit Postgres. Invalidation on
order.created/updated/status_changed (core/realtime.py) is the real
expiry; the TTLs below are only a backstop if a push is missed.

Deliberately not django-redis / Django's cache framework: this project
only needs a handful of get/set/delete calls plus pub/sub (which Channels
handles separately), and a thin wrapper keeps the redis-py client visible
instead of hidden behind a generic cache API.
"""

import json
import logging

import redis
from django.core.serializers.json import DjangoJSONEncoder
from django.conf import settings

logger = logging.getLogger(__name__)

_pool = None


def get_redis_client():
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    return redis.Redis(connection_pool=_pool)


# --- Order counts cache ------------------------------------------------
# Keyed per organization only (not per filter) - see oms/views.py counts()
# for why: the unfiltered, per-status counts are the hot path hit on every
# status-tab click, so that's the one shape worth caching. A request with
# extra filters (search, date range, ...) bypasses this cache entirely.

COUNTS_TTL_SECONDS = 60


def _counts_key(organization_id):
    return f"oms:counts:{organization_id}"


def get_cached_counts(organization_id):
    """Returns the cached counts dict, or None on a miss or if Redis is
    unreachable - callers should treat both the same way (fall through to
    the real query) rather than erroring the request."""
    try:
        raw = get_redis_client().get(_counts_key(organization_id))
    except redis.RedisError:
        logger.warning(
            "redis unavailable reading counts cache for org %s", organization_id, exc_info=True
        )
        return None
    return json.loads(raw) if raw else None


def set_cached_counts(organization_id, counts):
    try:
        get_redis_client().set(
            _counts_key(organization_id), json.dumps(counts), ex=COUNTS_TTL_SECONDS
        )
    except redis.RedisError:
        logger.warning(
            "redis unavailable writing counts cache for org %s", organization_id, exc_info=True
        )


def invalidate_counts_cache(organization_id):
    """Called from core/realtime.py whenever order.created/updated/
    status_changed fires, so a stale count is never served after a real
    change - the TTL above is only a backstop for a missed invalidation,
    not the primary mechanism."""
    try:
        get_redis_client().delete(_counts_key(organization_id))
    except redis.RedisError:
        logger.warning(
            "redis unavailable invalidating counts cache for org %s", organization_id, exc_info=True
        )


# --- Orders list / dashboard cache --------------------------------------
# Unfiltered tab views only (status + page + page_size). Search/date/city
# filters skip this so one filter's rows cannot leak into another. Dropped
# as a prefix when any order in the org changes, then rebuilt on the next
# request so the next tab click is a Redis hit instead of Postgres.

LIST_TTL_SECONDS = 3600
DASHBOARD_TTL_SECONDS = 3600


def _dumps(value):
    return json.dumps(value, cls=DjangoJSONEncoder)


def _list_key(organization_id, status, page, page_size):
    return f"oms:list:{organization_id}:{status}:{page}:{page_size}"


def _dashboard_key(organization_id, date_from, date_to):
    return f"oms:dashboard:{organization_id}:{date_from or 'all'}:{date_to or 'all'}"


def _delete_by_prefix(prefix):
    client = get_redis_client()
    keys = list(client.scan_iter(match=f"{prefix}*", count=100))
    if keys:
        client.delete(*keys)


def get_cached_list(organization_id, status, page, page_size):
    try:
        raw = get_redis_client().get(_list_key(organization_id, status, page, page_size))
    except redis.RedisError:
        logger.warning(
            "redis unavailable reading list cache for org %s", organization_id, exc_info=True
        )
        return None
    return json.loads(raw) if raw else None


def set_cached_list(organization_id, status, page, page_size, payload):
    try:
        get_redis_client().set(
            _list_key(organization_id, status, page, page_size),
            _dumps(payload),
            ex=LIST_TTL_SECONDS,
        )
    except redis.RedisError:
        logger.warning(
            "redis unavailable writing list cache for org %s", organization_id, exc_info=True
        )


def get_cached_dashboard(organization_id, date_from, date_to):
    try:
        raw = get_redis_client().get(_dashboard_key(organization_id, date_from, date_to))
    except redis.RedisError:
        logger.warning(
            "redis unavailable reading dashboard cache for org %s", organization_id, exc_info=True
        )
        return None
    return json.loads(raw) if raw else None


def set_cached_dashboard(organization_id, date_from, date_to, payload):
    try:
        get_redis_client().set(
            _dashboard_key(organization_id, date_from, date_to),
            _dumps(payload),
            ex=DASHBOARD_TTL_SECONDS,
        )
    except redis.RedisError:
        logger.warning(
            "redis unavailable writing dashboard cache for org %s", organization_id, exc_info=True
        )


def invalidate_order_view_cache(organization_id):
    """Drop every cached Orders/Dashboard payload for this org. The
    WebSocket push in core/realtime.py tells open browsers to refetch,
    which rebuilds these keys from Postgres."""
    try:
        invalidate_counts_cache(organization_id)
        _delete_by_prefix(f"oms:list:{organization_id}:")
        _delete_by_prefix(f"oms:dashboard:{organization_id}:")
    except redis.RedisError:
        logger.warning(
            "redis unavailable invalidating view cache for org %s", organization_id, exc_info=True
        )
