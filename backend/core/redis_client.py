"""Thin Redis helper shared by the order-counts cache and the realtime
pub/sub layer (see core/realtime.py, core/consumers.py). One process-wide
connection pool, sized for a single gunicorn/daphne worker - see
settings.REDIS_URL for where the host comes from.

Deliberately not django-redis / Django's cache framework: this project
only needs a handful of get/set/delete calls plus pub/sub (which Channels
handles separately), and a thin wrapper keeps the redis-py client visible
instead of hidden behind a generic cache API.
"""

import json
import logging

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

_pool = None


def get_redis_client():
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL, decode_responses=True, max_connections=20
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
