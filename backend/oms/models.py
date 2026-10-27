import uuid
from decimal import Decimal

from django.db import models
from django.db.models.expressions import RawSQL
from django.utils import timezone

from core.models import TenantScopedModel

from .storage import print_batch_storage


class Courier(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = '"oms"."couriers"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="oms_courier_name_per_org"
            )
        ]
        ordering = ["name"]

    def __str__(self):
        return self.name


def _next_supabase_order_no():
    """No longer the field's default (see Order.supabase_order_no) - kept
    because migration 0023 imports it.

    Atomically claims the next value of the oms.orders_supabase_no_seq
    Postgres sequence (created in the migration that adds this field) -
    one DB round trip, race-free by construction, regardless of which code
    path is creating the Order (manual, Shopify webhook, CSV import,
    Smartlane absorb). A plain app-level counter would need every one of
    those call sites to coordinate; nextval() needs none of them to know
    about each other."""
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval('oms.orders_supabase_no_seq')")
        return cursor.fetchone()[0]


class Order(TenantScopedModel):
    STATUS_CHOICES = [
        # Entry state for every synced/imported order - "nobody has looked
        # at this yet". CS moves it into Awaiting Assigning (see
        # services.acknowledge_order) once they start working it, which is
        # what separates "untouched inbox" from "in progress". Pending
        # CC/COD below are legacy - nothing new enters them any more.
        ("new", "New"),
        ("pending_cc", "Pending CC"),
        ("pending_cod", "Pending COD"),
        ("city_issue", "City Issue"),
        ("awaiting_assigning", "Approved (Awaiting Courier)"),
        ("awaiting_approval", "Awaiting Confirmation"),
        ("approved", "Approved"),
        # Reached from awaiting_assigning when a courier booking is pushed
        # to Smartlane (see services.push_order_to_smartlane) - parallel
        # to, not a replacement for, the manual approve/dispatch path
        # above. Smartlane's /create call doesn't return a consignment
        # number synchronously (see smartlane_client.create_booking) - it
        # only arrives later via /track polling or the webhook - so an
        # order sits here, with no tracking_number yet, until one does.
        ("booking_pending", "Awaiting Booking"),
        ("ready_to_print", "Ready to Print"),
        ("ready_to_pick", "Ready to Pick"),
        ("dispatch_issue", "Dispatch Issue"),
        ("awaiting_dispatched", "Awaiting Dispatched"),
        ("dispatched", "Dispatched"),
        # Smartlane-reported sub-stages of "dispatched" - richer than a
        # plain "still moving" bucket, but still no manual action of their
        # own (only ever reached via Smartlane data, see
        # integrations.services.apply_smartlane_status).
        ("out_for_delivery", "Out for Delivery"),
        ("attempt", "Delivery Attempt Failed"),
        ("delivered", "Delivered"),
        ("cancelled", "Cancelled"),
        ("returned", "Returned"),
    ]
    GATEWAY_CHOICES = [
        ("cc", "CC"),
        ("cod", "COD"),
    ]
    PAYMENT_STATUS_CHOICES = [
        ("pending", "Pending"),
        ("partially_paid", "Partially Paid"),
        ("paid", "Paid"),
    ]
    FULFILLMENT_STATUS_CHOICES = [
        ("unfulfilled", "Unfulfilled"),
        ("fulfilled", "Fulfilled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # A plain, globally sequential, human-readable order number - unlike
    # `id` (a random UUID, meaningless to read) or `order_number` (Shopify's
    # own number, absent/arbitrary for non-Shopify orders). Backed by a real
    # Postgres sequence (see the migration) so every insert - manual order,
    # Shopify webhook, CSV import, Smartlane absorb - gets the next number
    # automatically with no app-level counting/races. Global across every
    # organization, not per-org, by design (confirmed with the user).
    # db_default, not a Python default: the number is taken by the INSERT
    # itself, so an Order only built in memory (and never saved) no longer
    # uses one up - that left gaps in the count. A failed or rolled-back
    # insert, or a deleted order, still leaves one: a sequence never rewinds.
    supabase_order_no = models.PositiveIntegerField(
        null=True,
        blank=True,
        unique=True,
        editable=False,
        db_default=RawSQL("nextval('oms.orders_supabase_no_seq')", []),
    )
    order_number = models.CharField(max_length=50)
    customer_name = models.CharField(max_length=255)
    customer_phone = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="pending_cod")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Set only for orders synced from Shopify - lets webhook/sync upsert
    # idempotently instead of creating duplicates on redelivery.
    shopify_order_id = models.BigIntegerField(null=True, blank=True)
    # The Shopify Fulfillment created for this order (see integrations.
    # services.sync_order_to_shopify) - once set, later status changes post
    # a Fulfillment Event against this same id (Shopify's "Delivery status"
    # timeline) instead of trying to create a second fulfillment.
    shopify_fulfillment_id = models.BigIntegerField(null=True, blank=True)

    payment_gateway = models.CharField(max_length=10, choices=GATEWAY_CHOICES, default="cod")
    # Independent of `status` - a COD order can be Approved/Dispatched while
    # still Pending here until cash is actually collected on delivery.
    payment_status = models.CharField(
        max_length=20, choices=PAYMENT_STATUS_CHOICES, default="pending"
    )
    # Independent of `status` too - mirrors Shopify's own fulfillment_status,
    # not the internal dispatch pipeline.
    fulfillment_status = models.CharField(
        max_length=15, choices=FULFILLMENT_STATUS_CHOICES, default="unfulfilled"
    )

    city = models.CharField(max_length=100, blank=True, default="")
    # Denormalized label (ShopifyConnection.shop_domain for synced orders,
    # "Manual" for manually-created ones) - no multi-shop-per-org model yet.
    shop = models.CharField(max_length=150, blank=True, default="")

    courier = models.ForeignKey(
        Courier, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders"
    )
    tracking_number = models.CharField(max_length=100, blank=True, default="")
    # Set when the Dispatch Hub booked this order through FynkTech's own
    # courier account (the super admin's OMS Couriers tab - see core.
    # platform_service) instead of the store's: the reference that account
    # knows it by, store code + order number, since several stores' order
    # numbers collide inside one FynkTech account. While set, tracking,
    # printing, cancelling and status sync all go through FynkTech's
    # account. Empty for a booking made through the store's own account.
    platform_reference = models.CharField(max_length=100, blank=True, default="", db_index=True)
    # The courier's own word for where the parcel is - PostEx's "PostEx
    # WareHouse", BarqRaftar's "Received at FC", Smartlane's courier status -
    # as last reported (services.record_courier_status) or read off its
    # sheet (importers.py). `status` lumps many of these together (every
    # "still moving" one is Dispatched); the orders list shows this beside
    # it as the Sub Status. db_default too, not just default: Django drops a
    # plain default from the column once it's added, and then any code that
    # doesn't know this field yet (an older deploy on the same database)
    # fails every order INSERT on the NOT NULL.
    courier_status = models.CharField(max_length=100, blank=True, default="", db_default="")
    # Last time integrations.services.poll_smartlane_statuses asked Smartlane
    # about this order - null means never checked. Drives the poll query's
    # ordering (never-checked/longest-since-checked first) so a broad "check
    # every non-final order" sweep rotates through the backlog instead of
    # hammering the same ones every cycle. Set on both a match and a "no,
    # Smartlane doesn't know this order" response - either way it's been
    # asked, and needs to fall further back in the queue than orders not
    # asked about yet.
    smartlane_checked_at = models.DateTimeField(null=True, blank=True)
    issue_note = models.CharField(max_length=255, blank=True, default="")
    return_reason = models.CharField(max_length=255, blank=True, default="")
    # The note the customer left at checkout (Shopify's order `note`),
    # refreshed on every Shopify sync. Distinct from issue_note, which is
    # our own team's.
    customer_note = models.TextField(blank=True, default="", db_default="")
    # When this order first got a tracking number - the courier booking
    # actually landing, whichever path set it (direct booking, Smartlane's
    # late consignment number, Shopify's fulfillment, a sheet import). Set
    # in save() below, never cleared.
    booked_at = models.DateTimeField(null=True, blank=True)

    # When the order was actually placed (Shopify's order created_at for
    # synced orders). Distinct from `created_at` (TenantScopedModel's
    # auto_now_add), which is when this row was written here - those two
    # can differ by however long the order sat in Shopify before a sync
    # pulled it in. Null for manually-created orders; falls back to
    # `created_at` for display (see OrderSerializer.get_placed_at).
    placed_at = models.DateTimeField(null=True, blank=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    # Smartlane's "return_in_progress" stage - the parcel is already on its
    # way back from the customer, but the return isn't final yet (that's
    # returned_at below). Purely informational: does not change `status`,
    # which stays wherever it already was (almost always dispatched/
    # out_for_delivery/attempt). An earlier point on the exact same returns
    # timeline return_received_at (further below) tracks the tail end of -
    # belongs to WMS's returns-desk domain, not a new OMS pipeline status.
    return_in_progress_at = models.DateTimeField(null=True, blank=True)
    # When the courier reported the parcel as coming back.
    returned_at = models.DateTimeField(null=True, blank=True)
    # When the warehouse physically received and scanned it back in - a
    # separate, later event to returned_at, and the gap between the two is
    # exactly the "returned by courier but not yet in our hands" queue the
    # returns desk works from. Set by wms.services.restock_from_return.
    return_received_at = models.DateTimeField(null=True, blank=True)
    return_received_by = models.UUIDField(null=True, blank=True)
    # Membership has no cached display name (Supabase Auth owns that, not
    # Django), so the acting user's email is captured directly here at scan
    # time - same reason core.models.OrganizationAuditLog stores actor_email
    # rather than just actor_user_id.
    return_received_by_email = models.CharField(max_length=255, blank=True, default="")
    # Set alongside return_received_at, at the same scan - the warehouse
    # inspects the parcel the moment it's received, there's no separate
    # later inspection step. "good" restocks it (see
    # wms.services.restock_from_return); "bad" marks it received (it's
    # out of the awaiting-scan queue either way) but deliberately never
    # touches StockItem/StockMovement, since damaged units aren't sellable
    # stock.
    RETURN_CONDITION_CHOICES = [("good", "Good"), ("bad", "Bad")]
    return_condition = models.CharField(
        max_length=10, choices=RETURN_CONDITION_CHOICES, blank=True, default=""
    )
    # What the returns desk counted, per line, when it scanned the parcel:
    # [{key, sku, product_name, quantity, good, damaged, lost}]. Only the
    # good units went back into stock. return_condition is "good" when
    # every unit was good, else "bad". Null for parcels received before
    # this existed (or by the bulk Mark Good/Damaged, which records it too).
    return_breakdown = models.JSONField(null=True, blank=True)

    # Packing bench: stamped by wms.views.PackingView when a Ready to Pick
    # parcel is scanned as packed (-> awaiting_dispatched). No separate
    # packing record - these two fields are the whole of it.
    packed_at = models.DateTimeField(null=True, blank=True)
    packed_by_email = models.CharField(max_length=255, blank=True, default="")
    # How many times the courier has taken it out for delivery - bumped on
    # every move into out_for_delivery (services._apply_transition), so the
    # same courier event repeated never counts twice. Tells a first failed
    # attempt from a second one.
    delivery_attempts = models.PositiveSmallIntegerField(default=0, db_default=0)
    # Why an order is back in Approved after it had a booking: its booking
    # was cancelled for Edit Order ("cancelled_from_assigning"), or a
    # Change Courier cancelled the old booking but the new one failed
    # ("courier_change_failed"). Cleared once it leaves Approved again.
    workflow_flag = models.CharField(max_length=40, blank=True, default="", db_default="")

    # --- Customer/shipping profile (denormalized on Order, same convention
    # as customer_name/customer_phone - a real cross-order Customer model is
    # out of scope for now) ---
    customer_email = models.CharField(max_length=255, blank=True, default="")
    secondary_phone = models.CharField(max_length=50, blank=True, default="")
    address_line1 = models.CharField(max_length=255, blank=True, default="")
    address_line2 = models.CharField(max_length=255, blank=True, default="")
    country = models.CharField(max_length=100, blank=True, default="")
    postal_code = models.CharField(max_length=50, blank=True, default="")
    cnic = models.CharField(max_length=30, blank=True, default="")
    customer_tags = models.CharField(max_length=255, blank=True, default="")
    # Free-form label on the order itself (distinct from customer_tags,
    # which describes the customer). Set by hand or from a courier/finance
    # sheet during CSV import.
    tag = models.CharField(max_length=100, blank=True, default="")
    # Why the order was cancelled, whoever cancelled it: the reason typed
    # when cancelling in OMS (required there), or Shopify's own cancel
    # reason. Shown in the orders table's Tag column - kept apart from
    # `tag` so it never overwrites (or gets pushed to Shopify as) a tag.
    cancel_reason = models.CharField(max_length=255, blank=True, default="", db_default="")
    # Courier or accounting invoice reference, imported from the courier's
    # settlement sheet rather than generated here.
    invoice_number = models.CharField(max_length=100, blank=True, default="")
    # What the courier charged the store for this parcel, from its sheet
    # (oms/importers.py). Kept apart from shipping_amount on purpose: that
    # one is what the customer paid and counts towards the order total,
    # which must stay the Shopify order's own. Null until a sheet says.
    courier_charges = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    customer_type = models.CharField(max_length=50, blank=True, default="")
    expected_delivery_date = models.DateField(null=True, blank=True)
    # Free text, distinct from `courier` (this order's assigned courier) -
    # a customer-level preference, not an order-level assignment.
    preferred_courier = models.CharField(max_length=150, blank=True, default="")
    # Manually set - no risk-scoring logic exists to derive this.
    risk_status = models.CharField(max_length=50, blank=True, default="")
    price_conversion_rate = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    order_source = models.CharField(max_length=50, blank=True, default="")
    shipping_type = models.CharField(max_length=50, blank=True, default="")
    agent_id = models.CharField(max_length=50, blank=True, default="")

    # Set when a store that's in the Dispatch Hub marks this order as "please
    # dispatch this one for us" (see services.request_dispatch) - the Hub
    # flags it so the super admin knows FynkTech has to ship it, rather than
    # the store handling it itself. Cleared on withdrawal; ignored once the
    # order is booked (the Hub only shows it while the order is pre-booking).
    dispatch_requested_at = models.DateTimeField(null=True, blank=True)
    # When the Dispatch Hub booked this order with a courier - FynkTech
    # shipping it, whether or not the store sent it for dispatch. Cleared
    # when the store books it itself. Behind the "by FynkTech" tag.
    hub_dispatched_at = models.DateTimeField(null=True, blank=True)

    # --- Money breakdown. Grand total / amount receivable / owed-to-customer
    # are computed (see serializers.py), not stored, to avoid drift with
    # total_amount (treated as Subtotal - the sum of line items). ---
    coupon_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gift_card_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    loyalty_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    wallet_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    donation_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    shipping_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    express_stitching_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    parent_order = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="split_orders"
    )

    # Set when this order was made with an order's "Recreate" - a
    # Replacement (shown with an "R" next to its number) or a plain New
    # order - and which order it was recreated from. Recreated orders are
    # never created on Shopify.
    RECREATE_TYPE_CHOICES = [
        ("replacement", "Replacement"),
        ("new", "New order"),
    ]
    recreate_type = models.CharField(
        max_length=12, choices=RECREATE_TYPE_CHOICES, blank=True, default="", db_default=""
    )
    recreated_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="recreations"
    )

    class Meta:
        db_table = '"oms"."orders"'
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "order_number"], name="oms_order_number_per_org"
            ),
            models.UniqueConstraint(
                fields=["organization", "shopify_order_id"],
                name="oms_shopify_order_id_per_org",
                condition=models.Q(shopify_order_id__isnull=False),
            ),
        ]
        ordering = ["-created_at"]
        # Every page load filters/sorts by these - status (tabs, report),
        # created_at (default ordering, every unfiltered list), phone
        # (get_probability_map's per-page GROUP BY). None were indexed
        # despite being the most common WHERE/ORDER BY on the biggest
        # table in the app (9,000+ rows and growing) - a real, measurable
        # contributor to the app feeling slow at this scale, not a guess.
        indexes = [
            models.Index(fields=["organization", "status"], name="oms_order_org_status_idx"),
            models.Index(fields=["organization", "-created_at"], name="oms_order_org_created_idx"),
            models.Index(fields=["organization", "-placed_at"], name="oms_order_org_placed_idx"),
            models.Index(fields=["organization", "customer_phone"], name="oms_order_org_phone_idx"),
            models.Index(
                fields=["organization", "smartlane_checked_at"],
                name="oms_order_org_sl_checked_idx",
            ),
        ]

    def __str__(self):
        return self.order_number

    def save(self, *args, **kwargs):
        # Stamped here rather than at each booking call site - a tracking
        # number arrives through a dozen paths, and every one saves the
        # order. A save limited to update_fields gets booked_at added to it.
        if self.tracking_number and not self.booked_at:
            self.booked_at = timezone.now()
            update_fields = kwargs.get("update_fields")
            if update_fields is not None:
                kwargs["update_fields"] = {*update_fields, "booked_at"}
        super().save(*args, **kwargs)

    @property
    def grand_total(self):
        return (
            self.total_amount
            - self.coupon_discount
            - self.gift_card_discount
            - self.loyalty_amount
            - self.wallet_amount
            + self.total_tax
            + self.donation_amount
            + self.shipping_amount
            + self.express_stitching_amount
        )

    @property
    def amount_receivable(self):
        # Whatever amount_paid doesn't cover - so on a prepaid order a later
        # discount/shipping change moves the receivable while what was paid
        # stays put. A Paid order with no amount_paid recorded (older rows,
        # CSV imports) is taken as paid in full, never as cash to collect.
        if self.payment_status == "paid" and not self.amount_paid:
            return Decimal("0")
        return max(self.grand_total - self.amount_paid, 0)

    @property
    def owed_to_customer(self):
        return max(self.amount_paid - self.grand_total, 0)


class OrderItem(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product_name = models.CharField(max_length=255)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vendor = models.CharField(max_length=150, blank=True, default="")
    barcode = models.CharField(max_length=100, blank=True, default="")
    compare_at_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    weight_grams = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_items"'

    def __str__(self):
        return f"{self.product_name} x{self.quantity}"


class OrderStatusEvent(TenantScopedModel):
    """Generic audit trail for every Order.status transition. One shared
    table instead of per-type Dispatch/Return models - core.events.publish_event
    is in-process/ephemeral, so this is the only persisted history."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_events")
    from_status = models.CharField(max_length=30)
    to_status = models.CharField(max_length=30)
    note = models.CharField(max_length=255, blank=True, default="")
    # Supabase auth.users.id - same non-FK pattern as core.Membership.user_id.
    actor_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_status_events"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.order_id}: {self.from_status} -> {self.to_status}"


class OrderNote(TenantScopedModel):
    """Backs three tabs (Notes / Comments / Custom Message) with one table -
    they're all just timestamped text against an order, differing only in
    `kind`."""

    KIND_CHOICES = [
        ("note", "Note"),
        ("comment", "Comment"),
        ("custom_message", "Custom Message"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="notes")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="note")
    body = models.TextField()
    # Supabase auth.users.id - same non-FK pattern as core.Membership.user_id.
    author_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."order_notes"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} on {self.order_id}"


class OrderTransaction(TenantScopedModel):
    """Manually-logged payment record - no real payment-gateway integration
    exists yet, so this isn't a live transaction feed."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("success", "Success"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="transactions")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    method = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    reference = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        db_table = '"oms"."order_transactions"'
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.amount} ({self.status}) on {self.order_id}"


class Ticket(TenantScopedModel):
    """A tenant user's support request - either attached to one order or
    standalone (order is nullable). Status is the single source of truth
    for the lifecycle, same pattern as Order.status: raised as open, then
    moved by a super admin through pending / in_progress /
    awaiting_action to resolved (a reply also moves open/pending to
    in_progress on its own)."""

    STATUS_CHOICES = [
        ("open", "Open"),
        ("pending", "Pending"),
        ("in_progress", "In Progress"),
        ("awaiting_action", "Awaiting Action"),
        ("resolved", "Resolved"),
    ]

    # Who raised it, set from the request (never chosen): "customer" is a
    # store - FynkTech's client, whose shop is attached to OMS - and "admin"
    # is FynkTech's own super admin side (dispatching for stores etc.).
    TYPE_CHOICES = [
        ("customer", "By Customer"),
        ("admin", "By Admin"),
    ]

    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
        ("urgent", "Urgent"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Separate from the UUID pk on purpose: UUIDs aren't something a
    # customer or agent can read out loud or type into a search box.
    # Django's AutoField must be the primary key, so a second, human-facing
    # sequential number is backed by its own Postgres sequence instead
    # (created in the migration) - db_default means Django omits this
    # column from INSERT entirely and lets the DB assign the next value,
    # same as a real serial/identity column.
    number = models.BigIntegerField(
        unique=True, editable=False, db_default=RawSQL("nextval('oms.tickets_number_seq')", [])
    )
    order = models.ForeignKey(
        Order, on_delete=models.CASCADE, related_name="tickets", null=True, blank=True
    )
    category = models.CharField(max_length=100)
    sub_category = models.CharField(max_length=100, blank=True, default="")
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    ticket_type = models.CharField(
        max_length=10, choices=TYPE_CHOICES, default="customer", db_default="customer"
    )
    # No longer set or shown anywhere - kept so existing rows stay intact.
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    # Supabase auth.users.id - same non-FK pattern as OrderNote.author_user_id.
    created_by_user_id = models.UUIDField(null=True, blank=True)
    # Denormalized: Supabase Auth owns the display name/email, not Django,
    # and the cross-org admin list needs a "who" without joining auth.users.
    created_by_email = models.CharField(max_length=255, blank=True, default="")
    # No longer set or shown (the admin "Assign to me" action is gone) -
    # kept so existing rows stay intact.
    assigned_to_user_id = models.UUIDField(null=True, blank=True)
    assigned_to_email = models.CharField(max_length=255, blank=True, default="")
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."tickets"'
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="oms_ticket_org_created_idx"),
            models.Index(fields=["organization", "created_by_user_id"], name="oms_ticket_org_author_idx"),
            models.Index(fields=["organization", "status"], name="oms_ticket_org_status_idx"),
            models.Index(fields=["organization", "priority"], name="oms_ticket_org_priority_idx"),
        ]

    def __str__(self):
        return f"{self.ticket_number} - {self.category} ({self.status})"

    @property
    def ticket_number(self):
        return f"#{self.number:06d}"


class TicketMessage(TenantScopedModel):
    """One message in a ticket's conversation. author_role is stored at
    write time (not derived from author_user_id) purely so the UI can
    align/label a bubble without a second lookup - there's no Django User
    table to check a role against at render time.

    is_internal marks a superadmin-only note (never returned by the
    tenant-facing messages endpoint) - the standard helpdesk pattern of
    letting support staff leave context for each other on a ticket without
    the customer seeing it. Always False for tenant-authored messages."""

    ROLE_CHOICES = [("tenant", "Tenant"), ("super_admin", "Super Admin")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    body = models.TextField()
    author_user_id = models.UUIDField(null=True, blank=True)
    author_role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    author_email = models.CharField(max_length=255, blank=True, default="")
    is_internal = models.BooleanField(default=False)

    class Meta:
        db_table = '"oms"."ticket_messages"'
        # Ascending - this is a conversation thread, it reads top-to-bottom,
        # unlike every other timestamped model here.
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.author_role} on ticket {self.ticket_id}"


class DispatchBatch(TenantScopedModel):
    """One set of orders printed together - what the Batch page's History
    shows as a single card. Its documents (PrintBatch rows: the load sheet,
    the airway bill) are generated separately, from separate endpoints, and
    are filed into the same batch when they cover the same orders (see
    oms.batch_services.save_print_batch)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Human-facing id ("B-000123"), same sequence-backed pattern as
    # Ticket.number.
    number = models.BigIntegerField(
        unique=True, editable=False, db_default=RawSQL("nextval('oms.dispatch_batches_number_seq')", [])
    )
    # Empty until a document names one - a Smartlane airway bill isn't
    # scoped to a courier, its load sheet is.
    courier = models.CharField(max_length=50, blank=True, default="")
    created_by_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."dispatch_batches"'
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"], name="oms_dbatch_org_created_idx"),
        ]

    def __str__(self):
        return self.batch_number

    @property
    def batch_number(self):
        return f"B-{self.number:06d}" if self.number else ""


class DispatchBatchOrder(TenantScopedModel):
    """One order in a DispatchBatch. Removing an order from a batch only
    stamps removed_at - the order itself and the documents already
    generated (whose own order_numbers still list it) are left as they
    were."""

    batch = models.ForeignKey(DispatchBatch, on_delete=models.CASCADE, related_name="entries")
    # Nullable + snapshot number: the batch must still read correctly if
    # the order is later deleted.
    order = models.ForeignKey(
        Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="dispatch_batch_entries"
    )
    order_number = models.CharField(max_length=50)
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_by_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = '"oms"."dispatch_batch_orders"'
        ordering = ["order_number"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "order_number"], name="oms_dbatch_order_unique"),
        ]
        indexes = [
            models.Index(fields=["organization", "order_number"], name="oms_dbatch_order_number_idx"),
        ]

    def __str__(self):
        return f"{self.order_number} in {self.batch_id}"


def _print_batch_upload_path(instance, filename):
    # Grouped by org and day so a bucket/filesystem browse isn't one flat
    # folder of thousands of files - date comes from created_at's default
    # (auto_now_add hasn't run yet at upload time, so use utcnow directly).
    from django.utils import timezone

    stamp = timezone.now().strftime("%Y/%m/%d")
    return f"print_batches/{instance.organization_id}/{stamp}/{instance.id}_{filename}"


class PrintBatch(TenantScopedModel):
    """One generated loadsheet/airway-bill document, kept so it can be
    found and re-downloaded later exactly as it was originally generated -
    not re-fetched from Smartlane, which could return different data if
    anything about those orders changed since (or fail entirely if the
    consignment was later cancelled)."""

    KIND_CHOICES = [
        ("loadsheet", "Load Sheet"),
        ("airway_bill", "Airway Bill"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=15, choices=KIND_CHOICES)
    # Empty for airway_bill - Smartlane's airway/bill api isn't scoped to
    # one courier the way load_sheet is.
    courier = models.CharField(max_length=50, blank=True, default="")
    order_count = models.PositiveIntegerField(default=0)
    # Kept for search (order number lookup) and for display without a join
    # back to orders that may since have changed status/been deleted.
    order_numbers = models.JSONField(default=list, blank=True)
    file = models.FileField(upload_to=_print_batch_upload_path, storage=print_batch_storage)
    content_type = models.CharField(max_length=100, default="application/pdf")
    created_by_user_id = models.UUIDField(null=True, blank=True)
    # The batch card this document shows under on the Batch page.
    batch = models.ForeignKey(
        DispatchBatch, on_delete=models.SET_NULL, null=True, blank=True, related_name="documents"
    )

    class Meta:
        db_table = '"oms"."print_batches"'
        # updated_at, not created_at - a reprint of the same order set
        # reuses its row (see _save_print_batch) and should jump back to
        # the top to reflect what was actually just downloaded.
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.get_kind_display()} ({self.order_count} orders) {self.created_at:%Y-%m-%d}"


class City(models.Model):
    """One city name an order's city must match before the order can be
    Approved (oms.approval_checks) - "LHR" is held back until it reads
    "Lahore". Platform-wide, not per store (so not TenantScopedModel): one
    list for every store, kept by the super admin from the couriers' own
    city lists (oms.city_admin_services) and by hand."""

    SOURCE_CHOICES = [
        ("manual", "Added by hand"),
        ("postex", "PostEx"),
        ("barqraftar", "BarqRaftar"),
    ]

    name = models.CharField(max_length=100)
    # city_key(name) - what matching compares (case/spacing-insensitive).
    name_key = models.CharField(max_length=100, unique=True)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="manual")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"oms"."cities"'
        ordering = ["name"]

    def __str__(self):
        return self.name
