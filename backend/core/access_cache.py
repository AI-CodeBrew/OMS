"""A short in-process memo for the access lookups every request repeats -
is the store active, the caller's Membership, the store's enabled modules,
the Dispatch Hub's stores, a super admin staff login's pages, a store
group's stores (speed plan, 2026-11-20).

Each one is a database round trip (~60 ms from Fly to Supabase) asked on
every API call, while the rows behind them change a few times a month.
Nothing is skipped: every check still runs on every request, only its
answer is remembered.

Freshness:
- Any save or delete of the rows behind them (Organization, Membership,
  Role, OrganizationModule, DispatchHubStore, AdminRole, AdminStaff) clears
  the whole memo at once, and again when its transaction commits - so a
  removed member, a suspended store or a changed role is refused on the
  very next request (core.apps connects the signals).
- Every write to those tables goes through the ORM (save / update_or_create
  / delete - which all send the signals); a change made from another
  process (a `manage.py shell` on the server) is picked up within
  TTL_SECONDS.
- Nothing read inside a transaction is remembered (it may not be
  committed yet).
"""

import copy
import threading
import time

from django.db import connection, transaction

TTL_SECONDS = 30

_memo = {}
_lock = threading.Lock()
_generation = 0


def cached(key, compute):
    """compute() once per TTL_SECONDS for `key`; a copy of the value is
    returned each time, so a caller changing it can't change the memo."""
    now = time.monotonic()
    hit = _memo.get(key)
    if hit is not None and hit[1] > now:
        return copy.deepcopy(hit[0])
    generation = _generation
    value = compute()
    if not connection.in_atomic_block:
        with _lock:
            # Skipped when something was cleared while this was being read -
            # the value may be the old one.
            if generation == _generation:
                _memo[key] = (copy.deepcopy(value), now + TTL_SECONDS)
    return value


def clear():
    global _generation
    with _lock:
        _generation += 1
        _memo.clear()


def on_change(sender=None, **kwargs):
    """post_save / post_delete receiver: forget everything now, and again
    once the change is committed (a request reading in between would
    otherwise remember the old row)."""
    clear()
    transaction.on_commit(clear)


def connect_signals():
    from django.db.models.signals import post_delete, post_save

    from .models import (
        AdminRole, AdminStaff, DispatchHubStore, Membership, Organization, OrganizationModule, Role,
    )

    for model in (Organization, Membership, Role, OrganizationModule, DispatchHubStore, AdminRole, AdminStaff):
        post_save.connect(on_change, sender=model, dispatch_uid=f"access_cache_save_{model.__name__}")
        post_delete.connect(on_change, sender=model, dispatch_uid=f"access_cache_delete_{model.__name__}")
