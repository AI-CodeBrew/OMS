"""The orders report's "All" layout (Export CSV > All): one row per line
item, every column the Orders page's report has. Shared by the Export CSV
button (views.OrderViewSet.export) and the live data API
(export_api.orders_report), so both always give the same columns and values.
"""

from zoneinfo import ZoneInfo

from django.db.models import OuterRef, Prefetch, Subquery

from . import csv_report, services
from .models import Order, OrderItem, OrderNote, OrderStatusEvent


def all_orders_report(queryset, org_kwargs, *, text=csv_report.as_text):
    """(header, rows) for `queryset` - rows is a generator of lists, one
    per line item (an order with none: one row, item columns blank).
    `text` writes ID/number cells: csv_report.as_text for Excel (CSV), or
    a plain str for JSON."""
    items_prefetch = Prefetch("items", queryset=OrderItem.all_objects.filter(**org_kwargs))
    # "All" - one row per line item. Order-level fields repeat across
    # an order's rows; an order with no items still gets one row,
    # with the item columns blank.
    # select_related/prefetch/annotations: every column below comes
    # from these, never a query per order - a big export is
    # thousands of orders.
    from integrations.barqraftar.models import BarqRaftarShipment
    from integrations.postex.models import PostExShipment

    from .approval_checks import city_key
    from .models import City

    last_event =OrderStatusEvent.all_objects.filter(order=OuterRef("pk")).order_by("-created_at")
    last_note = OrderNote.all_objects.filter(order=OuterRef("pk")).order_by("-created_at")
    # Approved: out of the Awaiting Confirmation card and onward -
    # into Approved, or straight past it (booked on Smartlane's own
    # portal, a courier sheet import, marked by hand) - its latest
    # time, if that happened more than once. Never a cancel.
    confirmation = services.WORKFLOW_CARD_STATUSES["awaiting_confirmation"]
    last_approved = (
        OrderStatusEvent.all_objects.filter(order=OuterRef("pk"), from_status__in=confirmation)
        .exclude(to_status__in=confirmation | {"cancelled"})
        .order_by("-created_at")
    )
    queryset = (
        queryset.select_related("courier", "organization")
        .prefetch_related(
            items_prefetch,
            Prefetch(
                "postex_shipments",
                queryset=PostExShipment.all_objects.filter(**org_kwargs).order_by("-booked_at"),
            ),
            Prefetch(
                "barqraftar_shipments",
                queryset=BarqRaftarShipment.all_objects.filter(**org_kwargs).order_by("-booked_at"),
            ),
        )
        .annotate(
            _last_event_to=Subquery(last_event.values("to_status")[:1]),
            _last_event_note=Subquery(last_event.values("note")[:1]),
            _last_event_at=Subquery(last_event.values("created_at")[:1]),
            _last_note_body=Subquery(last_note.values("body")[:1]),
            _last_note_at=Subquery(last_note.values("created_at")[:1]),
            _last_approved_at=Subquery(last_approved.values("created_at")[:1]),
        )
    )
    status_labels = dict(Order.STATUS_CHOICES)
    header = [
        # OMS Order ID identifies an order on its own - one per order,
        # across every store - so count/dedupe on it. The Shopify
        # order number is the store's, and two stores can both
        # have #1176.
        "OMS Order ID",
        # The store's own number (Shopify's, or a manual / replacement
        # order's) - the original one, as the screens show it.
        "Store Order ID",
        "Client Name",
        "Store ID",
        "Store Name",
        # When the order landed in OMS (created_at) - one time only.
        "Order Date (PKT)",
        # When it was last approved - moved on from Awaiting
        # Confirmation, however that happened. Blank for orders
        # with no history (older orders).
        "Last Approved At (PKT)",
        "Customer Name",
        "Phone",
        "Email",
        "Address",
        "City",
        # From the super admin's City list - "Unknown" when the
        # city isn't on it (never a guess).
        "Province",
        "Product Name",
        "SKU Code",
        "Quantity",
        # COD or Prepaid (payment_gateway) - the only payment column
        # for now; Paid/Pending isn't reported.
        "Order Type",
        "Unit Price",
        "Delivery Amount",
        "Discount",
        "Subtotal",
        "Grand Total",
        "Amount Paid",
        "Total Receivable",
        "Customer Note",
        # The card, as the screens show it.
        "Order Status",
        # On the Critical Orders page right now (any of its cards).
        "Critical Order",
        "Sub Status",
        "Tag",
        "Shipper Advice",
        "Last Update",
        "Courier Name",
        "Tracking Number",
        "Booked At (PKT)",
        "Actual Weight (Courier)",
        "Picked At (PKT)",
        "Returning At (PKT)",
        "Delivered At (PKT)",
        "Returned At Warehouse (PKT)",
        "Proofs",
    ]

    # Date and time, in Pakistan time - the server runs in UTC,
    # so a plain .date() put early-morning orders on the day before.
    pkt = ZoneInfo("Asia/Karachi")

    def when(value):
        return value.astimezone(pkt).strftime("%Y-%m-%d %H:%M") if value else ""

    # Worked out now, not inside rows(): the store numbers are made
    # here for any store seen for the first time.
    store_ids = services.store_ids_for(
        queryset.order_by().values_list("organization_id", "shop").distinct()
    )
    provinces = {
        key: province
        for key, province in City.objects.exclude(province="").values_list("name_key", "province")
    }
    # One query per Critical Orders card, never one per order.
    critical_ids = set()
    for _key, _label, _hint, narrow in services.CRITICAL_REASONS:
        critical_ids.update(narrow(queryset.order_by()).values_list("id", flat=True))

    def rows():
        for order in queryset.iterator(chunk_size=500):
            discount = (
                order.coupon_discount + order.extra_discount + order.gift_card_discount
                + order.loyalty_amount + order.wallet_amount
            )
            before_items = [
                text(order.supabase_order_no or ""),
                text(order.original_order_number or order.order_number),
                # The client is the organization (Playback, One
                # Stations, ...) - the business FynkTech serves; it
                # can run several stores, each with its own number.
                order.organization.name,
                text(store_ids.get((str(order.organization_id), order.shop), "")),
                order.shop,
                # When the order landed in OMS.
                when(order.created_at),
                when(order._last_approved_at),
                order.customer_name,
                text(order.customer_phone),
                order.customer_email,
                ", ".join(filter(None, [order.address_line1, order.address_line2])),
                order.city,
                provinces.get(city_key(order.city)) or "Unknown",
            ]
            after_items = [
                str(order.shipping_amount),
                str(discount),
                str(order.total_amount),
                str(order.grand_total),
                str(order.amount_paid),
                str(order.amount_receivable),
                order.customer_note,
                services.card_label(order),
                "Yes" if order.id in critical_ids else "No",
                order.courier_status,
                services.latest_tag(order),
                " - ".join(filter(None, [order.shipper_advice, order.shipper_advice_remarks])),
                csv_report.last_update(order, status_labels, when),
                order.courier.name if order.courier_id else "",
                # Self delivered: no tracking number - says so.
                text(order.tracking_number)
                or (services.SELF_DELIVER_COURIER
                    if order.courier_id and order.courier.name == services.SELF_DELIVER_COURIER else ""),
                when(order.booked_at),
                csv_report.courier_weight(order),
                # Dispatched is the courier picking the parcel up
                # (PostEx "Picked by PostEx", BarqRaftar "Picked Up").
                when(order.dispatched_at),
                when(order.return_in_progress_at),
                when(order.delivered_at),
                when(order.return_received_at),
                csv_report.courier_proofs(order),
            ]
            # As the order screen says it: paid online is Prepaid.
            payment = (
                "Partially Paid" if order.payment_status == "partially_paid"
                else "COD" if order.payment_gateway == "cod" else "Prepaid"
            )
            items = list(order.items.all())
            if not items:
                yield before_items + ["", "", "", payment, ""] + after_items
                continue
            for item in items:
                yield before_items + [
                    item.product_name,
                    text(item.barcode),
                    item.quantity,
                    payment,
                    str(item.unit_price),
                ] + after_items

    return header, rows()
