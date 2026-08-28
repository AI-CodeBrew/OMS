import time
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import OperationalError, connections
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.events import publish_event
from oms.models import Courier, Order, OrderItem

from . import shopify_client, smartlane_client
from .models import ShopifyConnection, ShopifySyncJob


# Once an order reaches one of these, a later Shopify sync must not
# rewrite its status - the physical/financial outcome is already recorded
# on our side and Shopify's view is no longer authoritative.
TERMINAL_STATUSES = {"delivered", "returned", "cancelled"}


def _to_decimal(value):
    try:
        return Decimal(str(value)) if value is not None else Decimal("0")
    except InvalidOperation:
        return Decimal("0")


def _truncate(value, max_length):
    """Defensively caps a Shopify-sourced string to its column's
    max_length. A single unexpectedly long field (malformed address data,
    a postal code that's actually a full address, etc.) should never be
    able to abort an entire multi-thousand-order sync with a Postgres
    'value too long' error - better to store a truncated value than lose
    the whole order."""
    value = value or ""
    return value[:max_length]


# Shopify's shipment_status values that mean the parcel reached the
# customer / came back. Everything else (in_transit, out_for_delivery,
# label_printed, ...) still counts as on its way, which our pipeline
# already represents as "dispatched".
_SHOPIFY_DELIVERED = {"delivered"}
_SHOPIFY_RETURNED = {"returned", "return_to_sender"}


def _latest_fulfillment(shopify_order):
    """The most recent non-cancelled fulfillment, or None.

    Tracking number, carrier name and delivery status all live inside
    order.fulfillments[] rather than on the order itself - a partially
    fulfilled order can carry several, so the newest one is what
    describes where the parcel currently is.
    """
    fulfillments = [
        f
        for f in (shopify_order.get("fulfillments") or [])
        if (f.get("status") or "") != "cancelled"
    ]
    if not fulfillments:
        return None
    return sorted(fulfillments, key=lambda f: f.get("created_at") or "")[-1]


def _shipping_total(shopify_order):
    """Delivery charges. Prefers the money-set field, falling back to
    summing shipping_lines for older API payloads that lack it."""
    price_set = shopify_order.get("total_shipping_price_set") or {}
    shop_money = price_set.get("shop_money") or {}
    if shop_money.get("amount") is not None:
        return _to_decimal(shop_money.get("amount"))
    return sum(
        (_to_decimal(line.get("price")) for line in shopify_order.get("shipping_lines") or []),
        Decimal("0"),
    )


def upsert_order_from_shopify(organization_id, shopify_order, shop_label=""):
    """Create or update an oms.Order from a Shopify order payload (webhook
    or REST sync - same shape either way). Runs outside normal
    JWT-authenticated request context (webhooks carry no Supabase JWT), so
    it always uses the unscoped `all_objects` manager and passes
    organization_id explicitly rather than relying on ambient tenant
    context."""
    shopify_order_id = shopify_order["id"]
    customer = shopify_order.get("customer") or {}
    customer_name = (
        " ".join(filter(None, [customer.get("first_name"), customer.get("last_name")])).strip()
        or shopify_order.get("email")
        or "Unknown"
    )
    shipping_address = shopify_order.get("shipping_address") or {}
    billing_address = shopify_order.get("billing_address") or {}
    # order.phone/customer.phone are frequently null - guest/COD checkouts
    # (the common case here) only carry a contact number on the address,
    # which is what actually matters for delivery.
    phone = (
        shopify_order.get("phone")
        or customer.get("phone")
        or shipping_address.get("phone")
        or billing_address.get("phone")
        or ""
    )
    billing_phone = billing_address.get("phone") or ""
    secondary_phone = billing_phone if billing_phone and billing_phone != phone else ""

    financial_status = shopify_order.get("financial_status") or ""
    shopify_fulfillment_status = shopify_order.get("fulfillment_status")
    gateway = "cod" if financial_status in ("pending", "") else "cc"
    payment_status = "paid" if financial_status == "paid" else "pending"
    fulfillment_status = "fulfilled" if shopify_fulfillment_status == "fulfilled" else "unfulfilled"

    fulfillment = _latest_fulfillment(shopify_order) or {}
    shipment_status = (fulfillment.get("shipment_status") or "").lower()
    tracking_number = fulfillment.get("tracking_number") or ""
    if not tracking_number:
        numbers = fulfillment.get("tracking_numbers") or []
        tracking_number = numbers[0] if numbers else ""
    carrier_name = (fulfillment.get("tracking_company") or "").strip()

    if shopify_order.get("cancelled_at"):
        pipeline_status = "cancelled"
    elif shipment_status in _SHOPIFY_RETURNED:
        pipeline_status = "returned"
    elif shipment_status in _SHOPIFY_DELIVERED:
        pipeline_status = "delivered"
    elif shopify_fulfillment_status == "fulfilled":
        pipeline_status = "dispatched"
    else:
        # Everything unfulfilled enters the untouched "New" inbox. CS moves
        # it into Pending CC/COD when they pick it up (see
        # oms.services.acknowledge_order) - that hand-off is what makes
        # "nobody has looked at this" distinguishable from "in progress".
        pipeline_status = "new"

    order_number = shopify_order.get("name") or f"#{shopify_order.get('order_number', shopify_order_id)}"

    shopify_created_at = shopify_order.get("created_at")
    placed_at = parse_datetime(shopify_created_at) if shopify_created_at else None

    # Fields safe to refresh from Shopify on every sync. `status` is
    # deliberately NOT among them: it's our own pipeline state, advanced by
    # the CS/warehouse team, and re-syncing an order must never undo their
    # work by dragging it back to the entry state. It's set once, on
    # create, via create_defaults below.
    shopify_fields = {
        "order_number": _truncate(order_number, 50),
        "customer_name": _truncate(customer_name, 255),
        "customer_phone": _truncate(phone, 50),
        "secondary_phone": _truncate(secondary_phone, 50),
        "payment_gateway": gateway,
        "payment_status": payment_status,
        "fulfillment_status": fulfillment_status,
        "city": _truncate(shipping_address.get("city"), 100),
        "shop": _truncate(shop_label or "Shopify", 150),
        # total_amount is the SUBTOTAL (line items before shipping/tax/
        # discounts) - Order.grand_total adds the rest back on top. Mapping
        # Shopify's total_price here instead would double-count shipping
        # and tax once those are populated below, inflating the COD amount
        # couriers are told to collect.
        "total_amount": _to_decimal(shopify_order.get("subtotal_price")),
        "shipping_amount": _shipping_total(shopify_order),
        "total_tax": _to_decimal(shopify_order.get("total_tax")),
        "coupon_discount": _to_decimal(shopify_order.get("total_discounts")),
        "tracking_number": _truncate(tracking_number, 100),
        "customer_email": _truncate(shopify_order.get("email"), 255),
        "address_line1": _truncate(shipping_address.get("address1"), 255),
        "address_line2": _truncate(shipping_address.get("address2"), 255),
        "postal_code": _truncate(shipping_address.get("zip"), 50),
        "country": _truncate(shipping_address.get("country"), 100),
        "order_source": "Storefront",
        "placed_at": placed_at,
    }

    # The carrier Shopify recorded on the fulfillment ("TCS", "Leopards",
    # ...). Matched by name so repeated syncs reuse one Courier row rather
    # than creating a duplicate per order.
    if carrier_name:
        courier, _ = Courier.all_objects.get_or_create(
            organization_id=organization_id,
            name=_truncate(carrier_name, 150),
            defaults={"is_active": True},
        )
        shopify_fields["courier_id"] = courier.id

    order, created = Order.all_objects.update_or_create(
        organization_id=organization_id,
        shopify_order_id=shopify_order_id,
        defaults=shopify_fields,
        create_defaults={**shopify_fields, "status": pipeline_status},
    )

    # Outcomes Shopify genuinely knows better than our pipeline does -
    # applied on update too, but only ever moving an order forward, never
    # back onto one the team has already carried past this point.
    if not created and order.status not in TERMINAL_STATUSES:
        if pipeline_status == "cancelled":
            order.status = "cancelled"
            order.save(update_fields=["status", "updated_at"])
        elif pipeline_status == "returned":
            # Applied from any non-terminal state, not just dispatched: on a
            # historical re-pull an order may still be sitting early in the
            # pipeline here while Shopify already knows the parcel shipped
            # and came back. The physical outcome is the truth.
            order.status = "returned"
            order.returned_at = order.returned_at or timezone.now()
            order.save(update_fields=["status", "returned_at", "updated_at"])
        elif pipeline_status == "delivered":
            order.status = "delivered"
            order.delivered_at = order.delivered_at or timezone.now()
            order.save(update_fields=["status", "delivered_at", "updated_at"])

    # Line items can change between webhook deliveries (edited orders) -
    # full replace is simpler and safer than diffing.
    OrderItem.all_objects.filter(order=order).delete()
    for line_item in shopify_order.get("line_items", []):
        OrderItem.all_objects.create(
            organization_id=organization_id,
            order=order,
            product_name=_truncate(line_item.get("title") or "Item", 255),
            quantity=line_item.get("quantity") or 1,
            unit_price=_to_decimal(line_item.get("price")),
            barcode=_truncate(line_item.get("sku"), 100),
        )

    publish_event(
        "order.created" if created else "order.updated",
        {
            "organization_id": str(organization_id),
            "order_id": str(order.id),
            "order_number": order.order_number,
            "source": "shopify",
        },
    )
    return order, created


# How Smartlane's reported states map onto our pipeline. Anything not
# listed (queued, ready, dispatch, in_transit, out_for_delivery, ...)
# means the parcel is still moving, which "dispatched" already covers.
_SMARTLANE_STATUS_MAP = {
    "delivered": "delivered",
    "complete": "delivered",
    "completed": "delivered",
    "return": "returned",
    "returned": "returned",
    "return_in_progress": "returned",
    "cancel": "cancelled",
    "cancelled": "cancelled",
}

# Orders worth asking Smartlane about: already handed over, not yet at a
# final outcome.
_TRACKABLE_STATUSES = ("ready_to_print", "ready_to_pick", "dispatched", "awaiting_dispatched")


def poll_smartlane_statuses(organization_id, *, batch_size=100, limit=1000):
    """Pulls delivery outcomes from Smartlane and advances matching orders.

    Runs as a scheduled job (see the poll_smartlane management command)
    rather than waiting on the status webhook, because the webhook needs a
    publicly reachable HTTPS URL while this works from anywhere. Same
    data, a polling interval later.

    Only ever moves an order forward - a stale or out-of-order tracking
    row must not drag something already delivered back into transit.
    """
    from oms import services as oms_services
    from .models import SmartlaneConnection

    try:
        connection = SmartlaneConnection.all_objects.get(
            organization_id=organization_id, is_connected=True
        )
    except SmartlaneConnection.DoesNotExist:
        return {"checked": 0, "updated": 0, "detail": "Smartlane is not connected"}

    orders = list(
        Order.all_objects.filter(
            organization_id=organization_id, status__in=_TRACKABLE_STATUSES
        ).exclude(tracking_number="")[:limit]
    )
    if not orders:
        return {"checked": 0, "updated": 0}

    by_number = {o.order_number: o for o in orders}
    updated = 0

    for start in range(0, len(orders), batch_size):
        chunk = orders[start : start + batch_size]
        rows = smartlane_client.track_consignments(
            connection.api_key, [o.order_number for o in chunk]
        )
        for row in rows:
            if not isinstance(row, dict):
                continue
            order = by_number.get(str(row.get("store_order_id") or "").strip())
            if order is None:
                continue

            raw_status = (
                row.get("status") or row.get("courier_status") or row.get("state") or ""
            ).strip().lower().replace(" ", "_")
            target = _SMARTLANE_STATUS_MAP.get(raw_status)
            if not target or order.status == target:
                continue

            # Keep the consignment number Smartlane assigned, which for a
            # real booking only becomes known after the fact.
            consignment = (row.get("consignment_number") or "").strip()
            if consignment and consignment != order.tracking_number:
                order.tracking_number = _truncate(consignment, 100)
                order.save(update_fields=["tracking_number", "updated_at"])

            try:
                if target == "delivered":
                    oms_services.mark_delivered(order)
                elif target == "returned":
                    oms_services.scan_return(
                        organization_id=organization_id,
                        order_number=order.order_number,
                        reason="Reported returned by Smartlane",
                    )
                elif target == "cancelled":
                    oms_services.cancel_order(order, reason="Cancelled by Smartlane")
                updated += 1
            except oms_services.InvalidTransition:
                # Already past this point locally - the tracking row is
                # stale, not wrong. Skip rather than fail the whole poll.
                continue

    connection.last_event_at = timezone.now()
    connection.save(update_fields=["last_event_at"])
    return {"checked": len(orders), "updated": updated}


def _month_windows(start, end):
    """Yields (window_start, window_end) covering start..end one calendar
    month at a time, both timezone-aware UTC."""
    cursor = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while cursor <= end:
        if cursor.month == 12:
            nxt = cursor.replace(year=cursor.year + 1, month=1)
        else:
            nxt = cursor.replace(month=cursor.month + 1)
        yield cursor, min(nxt - timedelta(microseconds=1), end)
        cursor = nxt


def find_order_gaps(organization_id):
    """Compares what Shopify says exists against what we actually hold,
    month by month, and reports the windows that are short.

    Why this exists: incremental sync only ever looks *forward* from
    last_synced_at, so orders missed in the middle of history (an
    interrupted full sync that never covered a stretch) are invisible to
    it - clicking "Sync New Orders" forever returns 0 while the hole
    stays. This finds those holes so they can be backfilled explicitly.

    Month granularity is deliberate: one API call per month keeps the scan
    well inside Shopify's rate limit, and backfilling a whole month costs
    nothing extra because order upserts are idempotent.
    """
    connection = ShopifyConnection.all_objects.get(
        organization_id=organization_id, is_connected=True
    )
    args = (connection.shop_domain, connection.access_token, settings.SHOPIFY_API_VERSION)

    total_remote = shopify_client.fetch_order_count(*args)
    total_local = Order.all_objects.filter(
        organization_id=organization_id, shopify_order_id__isnull=False
    ).count()

    result = {
        "total_remote": total_remote,
        "total_local": total_local,
        "missing": max(total_remote - total_local, 0),
        "gaps": [],
    }
    if total_remote <= total_local:
        return result

    earliest_raw = shopify_client.fetch_earliest_order_date(*args)
    if not earliest_raw:
        return result
    earliest = parse_datetime(earliest_raw)
    now = timezone.now()

    # Local counts bucketed by month in one query rather than one per
    # window - the remote side is what costs API calls, not this.
    local_by_month = {}
    rows = (
        Order.all_objects.filter(organization_id=organization_id, shopify_order_id__isnull=False)
        .values_list("placed_at", "created_at")
    )
    for placed_at, created_at in rows:
        stamp = placed_at or created_at
        if stamp:
            local_by_month[(stamp.year, stamp.month)] = (
                local_by_month.get((stamp.year, stamp.month), 0) + 1
            )

    # Same bucketing at day resolution, for the drill-down below.
    local_by_day = {}
    for placed_at, created_at in rows:
        stamp = placed_at or created_at
        if stamp:
            key = stamp.date()
            local_by_day[key] = local_by_day.get(key, 0) + 1

    for window_start, window_end in _month_windows(earliest, now):
        remote = shopify_client.fetch_order_count(
            *args,
            created_at_min=window_start.isoformat(),
            created_at_max=window_end.isoformat(),
        )
        local = local_by_month.get((window_start.year, window_start.month), 0)
        if remote > local:
            month_gap = {
                "from": window_start.date().isoformat(),
                "to": window_end.date().isoformat(),
                "label": window_start.strftime("%b %Y"),
                "remote": remote,
                "local": local,
                "missing": remote - local,
            }
            # Narrow the month down to the specific days that are short.
            # Counts are cheap (one request each) while backfilling is
            # thousands of per-order writes, so spending ~30 extra requests
            # here to avoid re-pulling a whole complete month is a very
            # good trade - it's the difference between refetching 2,000
            # orders and refetching the 520 actually missing.
            month_gap["ranges"] = _find_day_ranges(
                args, window_start, window_end, local_by_day
            )
            result["gaps"].append(month_gap)
        # Stay comfortably under Shopify's ~2 requests/second.
        time.sleep(0.2)

    # Flattened, deduplicated day ranges across every gap - what the
    # backfill actually syncs.
    result["ranges"] = [r for gap in result["gaps"] for r in gap.get("ranges", [])]
    return result


def _find_day_ranges(args, month_start, month_end, local_by_day):
    """Walks a short month day by day and returns the contiguous runs of
    days where Shopify holds more orders than we do."""
    missing_days = []
    cursor = month_start
    while cursor <= month_end:
        day_end = min(
            cursor.replace(hour=23, minute=59, second=59, microsecond=999999), month_end
        )
        remote = shopify_client.fetch_order_count(
            *args, created_at_min=cursor.isoformat(), created_at_max=day_end.isoformat()
        )
        local = local_by_day.get(cursor.date(), 0)
        if remote > local:
            missing_days.append({"date": cursor.date(), "missing": remote - local})
        time.sleep(0.2)
        cursor += timedelta(days=1)

    # Collapse consecutive days into ranges so the backfill runs a handful
    # of wide queries rather than one per day.
    ranges = []
    for entry in missing_days:
        if ranges and entry["date"] == ranges[-1]["_end"] + timedelta(days=1):
            ranges[-1]["_end"] = entry["date"]
            ranges[-1]["to"] = entry["date"].isoformat()
            ranges[-1]["missing"] += entry["missing"]
        else:
            ranges.append(
                {
                    "from": entry["date"].isoformat(),
                    "to": entry["date"].isoformat(),
                    "missing": entry["missing"],
                    "_end": entry["date"],
                }
            )
    for r in ranges:
        r.pop("_end", None)
    return ranges


def _save_progress(job, update_fields, attempts=3, delay_seconds=3):
    """Saves sync progress with a short retry - Supabase's pooler host has
    been observed to have brief (few-second) DNS blips on this network, and
    losing a whole multi-hour sync to one transient hiccup (now that
    connect_timeout makes it fail fast instead of hanging - see
    config/settings/base.py) would be a worse outcome than a few seconds'
    pause here. A persistent outage still fails after `attempts` and
    propagates to run_shopify_sync's own try/except, same as before."""
    for attempt in range(attempts):
        try:
            job.save(update_fields=update_fields)
            return
        except OperationalError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay_seconds)


def _iter_windows(connection, windows):
    """Chains iter_order_pages across several date windows so a multi-range
    backfill reads as one continuous stream of pages to the caller."""
    for window_min, window_max in windows:
        yield from shopify_client.iter_order_pages(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            created_at_min=window_min,
            created_at_max=window_max,
        )


def collect_missing_order_ids(connection, organization_id, windows):
    """Order ids present in Shopify within `windows` but absent locally.

    Shopify can only filter by date, so a gap range always also contains
    orders we already hold - often the large majority of it. Asking for
    ids alone first (cheap: one field, 250 per page) and diffing against
    what's stored turns "re-fetch 2,600 orders to recover 530" into
    "fetch exactly the 530".
    """
    remote_ids = set()
    for window_min, window_max in windows:
        for id_page in shopify_client.iter_order_ids(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            created_at_min=window_min,
            created_at_max=window_max,
        ):
            remote_ids.update(id_page)

    if not remote_ids:
        return []

    local_ids = set(
        Order.all_objects.filter(
            organization_id=organization_id, shopify_order_id__in=remote_ids
        ).values_list("shopify_order_id", flat=True)
    )
    return sorted(remote_ids - local_ids)


def _iter_orders_by_ids(connection, order_ids, batch_size=250):
    """Yields pages of full order payloads for specific ids."""
    for start in range(0, len(order_ids), batch_size):
        yield shopify_client.fetch_orders_by_ids(
            connection.shop_domain,
            connection.access_token,
            settings.SHOPIFY_API_VERSION,
            order_ids[start : start + batch_size],
        )


def run_shopify_sync(organization_id, job_id, *, connection_id, created_at_min=None, created_at_max=None):
    """The actual sync work, run on a background thread (see
    integrations/views.py's ShopifySyncView.post). Threads don't inherit
    the request thread's tenant contextvar, so - like upsert_order_from_shopify
    above - this uses `all_objects` with an explicit organization_id
    throughout rather than relying on ambient context."""
    job = ShopifySyncJob.all_objects.get(organization_id=organization_id, id=job_id)
    try:
        connection = ShopifyConnection.all_objects.get(
            organization_id=organization_id, id=connection_id
        )
        job.status = "running"
        job.started_at = timezone.now()

        # A backfill job carries several disconnected windows; everything
        # else is a single (possibly unbounded) window.
        if job.ranges:
            windows = [
                (f"{r['from']}T00:00:00Z", f"{r['to']}T23:59:59Z") for r in job.ranges
            ]
        else:
            windows = [(created_at_min, created_at_max)]

        if job.ranges:
            # Backfill: resolve the exact ids we're missing first, so the
            # expensive per-order work covers only those - not every order
            # that happens to share a date with them.
            missing_ids = collect_missing_order_ids(connection, organization_id, windows)
            job.total_available = len(missing_ids)
            pages = _iter_orders_by_ids(connection, missing_ids)
        else:
            # Best-effort - if Shopify's count endpoint is briefly
            # unreachable, the sync still runs, it just can't show a
            # "remaining" figure.
            try:
                job.total_available = sum(
                    shopify_client.fetch_order_count(
                        connection.shop_domain,
                        connection.access_token,
                        settings.SHOPIFY_API_VERSION,
                        created_at_min=window_min,
                        created_at_max=window_max,
                    )
                    for window_min, window_max in windows
                )
            except shopify_client.ShopifyAPIError:
                job.total_available = None
            pages = _iter_windows(connection, windows)

        job.save(update_fields=["status", "started_at", "total_available", "updated_at"])

        shop_label = connection.shop_name or connection.shop_domain
        for page in pages:
            for i, shopify_order in enumerate(page):
                # One order with unexpected data (encoding issue, a field
                # value Postgres rejects, etc.) must not abort a run that's
                # otherwise successfully processing thousands of others -
                # count it and move on instead of letting the whole sync
                # fail. `_truncate` in upsert_order_from_shopify already
                # handles the common case (an oversized field); this is the
                # backstop for anything else.
                try:
                    _, created = upsert_order_from_shopify(
                        organization_id, shopify_order, shop_label=shop_label
                    )
                    if created:
                        job.created_count += 1
                    else:
                        job.updated_count += 1
                except Exception as exc:  # noqa: BLE001 - see comment above
                    job.skipped_count += 1
                    job.error_message = (
                        f"Skipped order {shopify_order.get('name', shopify_order.get('id'))}: {exc}"
                    )[:500]
                job.total_fetched += 1

                # Orders arrive in created_at-ascending order (see
                # iter_order_pages), so this is always moving forward -
                # if this job dies, the next one resumes from exactly here
                # instead of restarting the whole sync from page 1.
                order_created_at = shopify_order.get("created_at")
                if order_created_at:
                    job.resume_cursor = order_created_at

                # Each order is a real DB round-trip (~0.5-1s) - a 250-order
                # page can take minutes, so save progress every 25 orders
                # instead of only once per full page. Otherwise the polling
                # UI shows nothing moving for that whole stretch and looks
                # stuck even though it's working.
                if (i + 1) % 25 == 0:
                    _save_progress(
                        job,
                        [
                            "total_fetched",
                            "created_count",
                            "updated_count",
                            "skipped_count",
                            "error_message",
                            "resume_cursor",
                            "updated_at",
                        ],
                    )

            job.pages_fetched += 1
            _save_progress(
                job,
                [
                    "pages_fetched",
                    "total_fetched",
                    "created_count",
                    "updated_count",
                    "skipped_count",
                    "error_message",
                    "resume_cursor",
                    "updated_at",
                ]
            )

            # Cooperative cancellation - re-read just this one flag (not the
            # whole row, which would clobber the counters just saved above)
            # to see if the cancel endpoint was hit by a separate request
            # while this page was in flight.
            job.refresh_from_db(fields=["cancel_requested", "status"])
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = timezone.now()
                job.save(update_fields=["status", "finished_at", "updated_at"])
                return
            if job.status not in ("pending", "running"):
                # A GET poll already marked this job stale/failed (its
                # updated_at went quiet past STALE_JOB_SECONDS - see
                # views.ShopifySyncView.get) while this thread was actually
                # still alive, just slow. Don't stomp that externally-set
                # terminal status back to "completed" - the orders already
                # upserted above are safe regardless, but the job record
                # should stay whatever the frontend already reported.
                return

        job.status = "completed"
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "finished_at", "updated_at"])

        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at"])
    except Exception as exc:  # noqa: BLE001 - unsupervised background thread, must not vanish silently
        job.status = "failed"
        job.error_message = str(exc)[:500]
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error_message", "finished_at", "updated_at"])
    finally:
        # Background threads must close their own DB connections - Django
        # only recycles them automatically around the request/response cycle.
        connections.close_all()
