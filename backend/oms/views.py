import csv

from django.db.models import Count, F, Prefetch, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.http import HttpResponse, StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from core.permissions import RequireModule
from wms.services import InsufficientStock

from . import services
from .models import Courier, Order, OrderItem, OrderNote, OrderTransaction
from .serializers import (
    CourierSerializer,
    OrderNoteSerializer,
    OrderSerializer,
    OrderStatusEventSerializer,
    OrderSummarySerializer,
    OrderTransactionSerializer,
)

SEARCHABLE_FIELDS = {
    "order_number": "order_number__icontains",
    "customer_name": "customer_name__icontains",
    "customer_phone": "customer_phone__icontains",
}

BULK_ACTIONS = {
    "acknowledge": lambda order, params, actor: services.acknowledge_order(
        order, actor_user_id=actor
    ),
    "confirm": lambda order, params, actor: services.confirm_order(
        order, city_ok=params.get("city_ok", True), actor_user_id=actor
    ),
    "resolve_city_issue": lambda order, params, actor: services.resolve_city_issue(
        order, new_city=params.get("city", order.city), actor_user_id=actor
    ),
    "assign_courier": lambda order, params, actor: services.assign_courier(
        order, courier_id=params["courier_id"], actor_user_id=actor
    ),
    "approve": lambda order, params, actor: services.approve_order(order, actor_user_id=actor),
    "queue_for_dispatch": lambda order, params, actor: services.queue_for_dispatch(
        order, actor_user_id=actor
    ),
    "mark_dispatch_issue": lambda order, params, actor: services.mark_dispatch_issue(
        order, note=params.get("note", ""), actor_user_id=actor
    ),
    "retry_dispatch": lambda order, params, actor: services.retry_dispatch(order, actor_user_id=actor),
    "mark_delivered": lambda order, params, actor: services.mark_delivered(order, actor_user_id=actor),
    "cancel": lambda order, params, actor: services.cancel_order(
        order, reason=params.get("reason", ""), actor_user_id=actor
    ),
    "dispatch": lambda order, params, actor: services.dispatch_order(
        order, tracking_number=params.get("tracking_number", ""), actor_user_id=actor
    ),
    "cancel_fulfillment": lambda order, params, actor: services.cancel_fulfillment(
        order, actor_user_id=actor
    ),
    "push_to_smartlane": lambda order, params, actor: services.push_order_to_smartlane(
        order, actor_user_id=actor, force=bool(params.get("force"))
    ),
}


class OrderPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = "page_size"
    # Generous cap - the frontend lets users type a custom row count, not
    # just the 10/25/50/100 presets.
    max_page_size = 1000


class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [RequireModule]
    required_module = "oms"
    pagination_class = OrderPagination

    def get_queryset(self):
        # Order.objects already scopes to the caller's organization via
        # TenantScopedModel's manager; filtering explicitly here too keeps
        # the query readable without relying on that being remembered.
        qs = Order.objects.filter(organization_id=self.request.organization_id).prefetch_related(
            "items"
        )
        return self._apply_filters(qs, self.request.query_params)

    def _apply_filters(self, qs, params):
        status_param = params.get("status")
        if status_param:
            qs = qs.filter(status__in=[s.strip() for s in status_param.split(",") if s.strip()])

        search = params.get("search")
        search_field = params.get("search_field", "order_number")
        if search:
            lookup = SEARCHABLE_FIELDS.get(search_field, SEARCHABLE_FIELDS["order_number"])
            qs = qs.filter(**{lookup: search})

        city = params.get("city")
        if city:
            qs = qs.filter(city__icontains=city)

        courier_id = params.get("courier_id")
        if courier_id:
            qs = qs.filter(courier_id=courier_id)

        gateway = params.get("gateway")
        if gateway:
            qs = qs.filter(payment_gateway=gateway)

        # Returns desk: split courier-reported returns into what the
        # warehouse has physically scanned back in and what it hasn't.
        received = params.get("received")
        if received == "yes":
            qs = qs.filter(return_received_at__isnull=False)
        elif received == "no":
            qs = qs.filter(return_received_at__isnull=True)

        date_from = params.get("date_from")
        date_to = params.get("date_to")
        if date_from or date_to:
            # Filter by when the order was actually placed (Shopify's own
            # created_at, see Order.placed_at), falling back to this row's
            # own created_at for manually-created orders that have no
            # placed_at - not by when we happened to fetch/sync it.
            qs = qs.annotate(effective_date=Coalesce("placed_at", "created_at"))
            if date_from:
                qs = qs.filter(effective_date__date__gte=date_from)
            if date_to:
                qs = qs.filter(effective_date__date__lte=date_to)

        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        rows = page if page is not None else queryset
        phone_numbers = [o.customer_phone for o in rows]
        probability_map = services.get_probability_map(
            organization_id=request.organization_id, phone_numbers=phone_numbers
        )
        serializer = self.get_serializer(
            rows, many=True, context={**self.get_serializer_context(), "probability_map": probability_map}
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = services.create_order(
            organization_id=request.organization_id,
            order_number=serializer.validated_data["order_number"],
            customer_name=serializer.validated_data["customer_name"],
            customer_phone=serializer.validated_data.get("customer_phone", ""),
            items=serializer.validated_data["items"],
        )
        output = self.get_serializer(order)
        return Response(output.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        probability_map = services.get_probability_map(
            organization_id=request.organization_id, phone_numbers=[instance.customer_phone]
        )
        serializer = self.get_serializer(
            instance, context={**self.get_serializer_context(), "probability_map": probability_map}
        )
        return Response(serializer.data)

    def update(self, request, *args, **kwargs):
        # Default ModelSerializer.update() can't handle the nested `items`
        # write (it's a reverse FK manager, not a plain attribute) - bypass
        # it the same way create() bypasses serializer.save(), and route
        # through services.update_order_detail instead. Read-only fields
        # (status, courier, timestamps, ...) are simply absent from
        # validated_data, so they can't be smuggled in through this path.
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data.pop("items", None)
        order = services.update_order_detail(instance, fields=serializer.validated_data, items=items)
        output = self.get_serializer(order)
        return Response(output.data)

    @action(detail=False, methods=["get"])
    def counts(self, request):
        # Deliberately ignore `status` here (even if the caller passes one) -
        # counts must reflect every tab, not just the active one.
        params_without_status = request.query_params.copy()
        params_without_status.pop("status", None)
        qs = self._apply_filters(
            Order.objects.filter(organization_id=request.organization_id), params_without_status
        )
        rows = qs.values("status").annotate(count=Count("id"))
        counts = {value: 0 for value, _label in Order.STATUS_CHOICES}
        for row in rows:
            counts[row["status"]] = row["count"]
        counts["all"] = sum(counts.values())
        return Response(counts)

    @action(detail=False, methods=["get"], url_path="returns-summary")
    def returns_summary(self, request):
        """Counts for the returns desk. `received` is driven by
        return_received_at rather than by the presence of stock movements,
        so an order whose SKUs aren't tracked in WMS still counts as
        physically received once someone scans it."""
        # Drop `received` before filtering - these counts must describe both
        # sides of that split, not just whichever side is being viewed.
        params = request.query_params.copy()
        params.pop("received", None)
        qs = self._apply_filters(
            Order.objects.filter(organization_id=request.organization_id, status="returned"),
            params,
        )
        total = qs.count()
        received = qs.filter(return_received_at__isnull=False).count()
        return Response(
            {
                "total_returns": total,
                "received": received,
                "awaiting_scan": total - received,
            }
        )

    @action(detail=False, methods=["get"])
    def dashboard(self, request):
        queryset = self._apply_filters(
            Order.objects.filter(organization_id=request.organization_id), request.query_params
        )

        status_rows = queryset.values("status").annotate(count=Count("id"))
        status_breakdown = {value: 0 for value, _label in Order.STATUS_CHOICES}
        for row in status_rows:
            status_breakdown[row["status"]] = row["count"]

        # Day-by-day volume for the trend chart, keyed by the order's real
        # placed date (not fetch date) - same Coalesce used everywhere else
        # so this lines up with what the date filter itself means.
        trend_rows = (
            queryset.annotate(day=TruncDate(Coalesce("placed_at", "created_at")))
            .values("day")
            .annotate(count=Count("id"))
            .order_by("day")
        )
        trend = [{"date": row["day"].isoformat(), "count": row["count"]} for row in trend_rows]

        # grand_total is a Python property (see Order.grand_total) - mirrored
        # here as a DB expression so it can be summed across the queryset in
        # one query instead of loading every row into Python.
        grand_total_expr = (
            F("total_amount")
            - F("coupon_discount")
            - F("gift_card_discount")
            - F("loyalty_amount")
            - F("wallet_amount")
            + F("total_tax")
            + F("donation_amount")
            + F("shipping_amount")
            + F("express_stitching_amount")
        )
        money = queryset.aggregate(grand_total_sum=Sum(grand_total_expr), paid_sum=Sum("amount_paid"))
        grand_total_sum = money["grand_total_sum"] or 0
        paid_sum = money["paid_sum"] or 0
        pending_receivable = max(grand_total_sum - paid_sum, 0)

        city_breakdown = list(
            queryset.exclude(city="")
            .values("city")
            .annotate(count=Count("id"))
            .order_by("-count")[:8]
        )
        courier_breakdown = list(
            queryset.filter(courier__isnull=False)
            .values(name=F("courier__name"))
            .annotate(count=Count("id"))
            .order_by("-count")[:8]
        )

        return Response(
            {
                "total_orders": queryset.count(),
                "status_breakdown": status_breakdown,
                "trend": trend,
                "cod_summary": {
                    "collected": str(paid_sum),
                    "pending": str(pending_receivable),
                    "grand_total": str(grand_total_sum),
                },
                "city_breakdown": city_breakdown,
                "courier_breakdown": courier_breakdown,
            }
        )

    @action(detail=False, methods=["post"], url_path="bulk-action")
    def bulk_action(self, request):
        action_name = request.data.get("action")
        order_ids = request.data.get("order_ids") or []
        params = request.data.get("params") or {}
        handler = BULK_ACTIONS.get(action_name)
        if not handler:
            return Response(
                {"detail": f"Unknown action {action_name!r}"}, status=status.HTTP_400_BAD_REQUEST
            )

        actor = request.user_id
        results = []
        orders_by_id = {
            str(order.id): order
            for order in Order.objects.filter(
                organization_id=request.organization_id, id__in=order_ids
            )
        }
        for order_id in order_ids:
            order = orders_by_id.get(str(order_id))
            if not order:
                results.append({"order_id": order_id, "success": False, "error": "Not found"})
                continue
            try:
                handler(order, params, actor)
                results.append({"order_id": order_id, "success": True})
            except InsufficientStock as exc:
                # Structured rather than a flat message: the UI needs the
                # per-SKU shortage detail to show what's short and offer
                # "proceed anyway" (which retries with params.force=True).
                results.append(
                    {
                        "order_id": order_id,
                        "order_number": order.order_number,
                        "success": False,
                        "error": str(exc),
                        "error_code": "insufficient_stock",
                        "shortages": exc.shortages,
                    }
                )
            except (services.InvalidTransition, services.SmartlaneBookingError, KeyError) as exc:
                results.append({"order_id": order_id, "success": False, "error": str(exc)})

        return Response({"results": results})

    @action(detail=False, methods=["post"], url_path="scan-dispatch")
    def scan_dispatch(self, request):
        order_number = (request.data.get("order_number") or "").strip()
        if not order_number:
            return Response({"detail": "order_number is required"}, status=status.HTTP_400_BAD_REQUEST)
        result = services.scan_dispatch(
            organization_id=request.organization_id,
            order_number=order_number,
            tracking_number=(request.data.get("tracking_number") or "").strip(),
            actor_user_id=request.user_id,
        )
        return Response(result)

    @action(detail=False, methods=["post"], url_path="scan-return")
    def scan_return(self, request):
        order_number = (request.data.get("order_number") or "").strip()
        if not order_number:
            return Response({"detail": "order_number is required"}, status=status.HTTP_400_BAD_REQUEST)
        result = services.scan_return(
            organization_id=request.organization_id,
            order_number=order_number,
            reason=(request.data.get("reason") or "").strip(),
            actor_user_id=request.user_id,
        )
        return Response(result)

    def _print_document_html(self, order, title):
        items_rows = "".join(
            f"<tr><td>{item.product_name}</td><td>{item.quantity}</td></tr>"
            for item in order.items.all()
        ) or "<tr><td colspan='2'>No items</td></tr>"
        address = " ".join(filter(None, [order.address_line1, order.address_line2]))
        return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title} - {order.order_number}</title>
<style>
  body {{ font-family: Arial, sans-serif; color: #0f172a; padding: 32px; max-width: 640px; margin: 0 auto; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .sub {{ color: #64748b; font-size: 13px; margin-bottom: 20px; }}
  .tracking {{ font-family: 'Courier New', monospace; font-size: 22px; font-weight: bold;
    letter-spacing: 2px; background: #f1f5f9; padding: 10px 14px; border-radius: 6px; display: inline-block; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
  th, td {{ text-align: left; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; font-size: 13px; }}
  .label {{ color: #64748b; font-size: 11px; text-transform: uppercase; }}
  .print-btn {{ margin-top: 24px; padding: 8px 16px; }}
  @media print {{ .print-btn {{ display: none; }} }}
</style></head>
<body>
  <h1>{title}</h1>
  <p class="sub">Order {order.order_number} &middot; {order.courier.name if order.courier_id else "Smartlane"}</p>
  <div class="tracking">{order.tracking_number or "No tracking number"}</div>
  <div class="grid">
    <div><div class="label">Customer</div>{order.customer_name}</div>
    <div><div class="label">Phone</div>{order.customer_phone}</div>
    <div><div class="label">Address</div>{address}</div>
    <div><div class="label">City</div>{order.city}</div>
    <div><div class="label">Amount</div>Rs {order.amount_receivable}</div>
    <div><div class="label">Payment</div>{order.payment_gateway.upper()}</div>
  </div>
  <table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>{items_rows}</tbody></table>
  <button class="print-btn" onclick="window.print()">Print</button>
</body></html>"""

    @action(detail=True, methods=["get"])
    def loadsheet(self, request, pk=None):
        order = self.get_object()
        try:
            services.mark_ready_to_pick(order, actor_user_id=request.user_id)
        except services.InvalidTransition:
            pass  # already past/before Ready to Print - still show the sheet, just don't re-transition
        return HttpResponse(self._print_document_html(order, "Loadsheet"), content_type="text/html")

    @action(detail=True, methods=["get"], url_path="airway-bill")
    def airway_bill(self, request, pk=None):
        order = self.get_object()
        return HttpResponse(self._print_document_html(order, "Airway Bill"), content_type="text/html")

    @action(detail=True, methods=["get", "post"])
    def notes(self, request, pk=None):
        order = self.get_object()
        if request.method == "POST":
            kind = request.data.get("kind", "note")
            body = (request.data.get("body") or "").strip()
            if not body:
                return Response({"detail": "body is required"}, status=status.HTTP_400_BAD_REQUEST)
            note = OrderNote.objects.create(
                organization_id=order.organization_id,
                order=order,
                kind=kind,
                body=body,
                author_user_id=request.user_id,
            )
            return Response(OrderNoteSerializer(note).data, status=status.HTTP_201_CREATED)

        kind = request.query_params.get("kind")
        qs = order.notes.all()
        if kind:
            qs = qs.filter(kind=kind)
        return Response(OrderNoteSerializer(qs, many=True).data)

    @action(detail=True, methods=["get", "post"])
    def transactions(self, request, pk=None):
        order = self.get_object()
        if request.method == "POST":
            serializer = OrderTransactionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            transaction = OrderTransaction.objects.create(
                organization_id=order.organization_id, order=order, **serializer.validated_data
            )
            return Response(OrderTransactionSerializer(transaction).data, status=status.HTTP_201_CREATED)

        return Response(OrderTransactionSerializer(order.transactions.all(), many=True).data)

    @action(detail=True, methods=["get"])
    def log(self, request, pk=None):
        order = self.get_object()
        return Response(OrderStatusEventSerializer(order.status_events.all(), many=True).data)

    @action(detail=True, methods=["get"], url_path="customer-history")
    def customer_history(self, request, pk=None):
        order = self.get_object()
        if not order.customer_phone:
            return Response([])
        siblings = (
            Order.objects.filter(
                organization_id=order.organization_id, customer_phone=order.customer_phone
            )
            .exclude(id=order.id)
            .order_by("-created_at")
        )
        return Response(OrderSummarySerializer(siblings, many=True).data)

    @action(detail=True, methods=["get"], url_path="split-orders")
    def split_orders(self, request, pk=None):
        order = self.get_object()
        return Response(OrderSummarySerializer(order.split_orders.all(), many=True).data)

    @action(detail=True, methods=["post"])
    def split(self, request, pk=None):
        order = self.get_object()
        item_splits = request.data.get("items") or []
        if not item_splits:
            return Response({"detail": "items is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            child = services.split_order(order, item_splits=item_splits, actor_user_id=request.user_id)
        except OrderItem.DoesNotExist:
            return Response({"detail": "Unknown item_id"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(child).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def export(self, request):
        org_id = request.organization_id
        queryset = self._apply_filters(
            Order.objects.filter(organization_id=org_id), request.query_params
        )
        template = request.query_params.get("template", "all")
        # StreamingHttpResponse doesn't actually run its generator until
        # after this view returns and the middleware chain has already
        # unwound - by then TenantMiddleware's contextvar has been reset,
        # so any lazy `order.items.all()` call made inside the generator
        # would silently see no tenant context and return nothing (not an
        # error - the tenant-scoped manager just fails closed). Prefetching
        # with an explicit `all_objects` queryset bakes the real org_id in
        # now, while the context is still valid, so the cache it populates
        # is correct regardless of when the generator actually iterates it.
        items_prefetch = Prefetch("items", queryset=OrderItem.all_objects.filter(organization_id=org_id))

        class Echo:
            def write(self, value):
                return value

        def dummy_email(order):
            # Smartlane's template requires an email per row - orders placed
            # without one (common for COD checkouts) get a synthesized
            # placeholder instead of an empty cell, since a blank email is
            # what triggers the courier portal to reject the row.
            slug = "".join(order.customer_name.lower().split()) or "customer"
            return f"{slug}@gmail.com"

        if template == "smartlane":
            queryset = queryset.prefetch_related(items_prefetch)
            header = [
                "Amount",
                "Weight",
                "Product",
                "Description",
                "Product Count",
                "City",
                "Name",
                "Payment Method",
                "Order No.",
                "Email",
                "Phone No.",
                "Special Handling",
                "Address",
                "Warehouse",
            ]

            def rows():
                yield header
                for order in queryset.iterator(chunk_size=500):
                    items = list(order.items.all())
                    product = "; ".join(f"{item.barcode},{item.product_name}" for item in items) or (
                        f",{order.order_number}"
                    )
                    description = "; ".join(
                        f"{item.product_name} (Qty: {item.quantity})" for item in items
                    ) or order.order_number
                    product_count = sum(item.quantity for item in items) or 1
                    weight_kg = sum((item.weight_grams or 0) * item.quantity for item in items) / 1000
                    address = " ".join(filter(None, [order.address_line1, order.address_line2]))
                    yield [
                        str(order.amount_receivable),
                        f"{weight_kg:.2f}" if weight_kg else "",
                        product,
                        description,
                        product_count,
                        order.city,
                        order.customer_name,
                        order.payment_gateway,
                        order.order_number,
                        order.customer_email or dummy_email(order),
                        order.customer_phone,
                        0,
                        address,
                        # No warehouse/WMS module exists yet to source this
                        # from - left blank rather than fabricated.
                        "",
                    ]

            filename = "orders_smartlane.csv"
        else:
            # "All" - every stored field from both Order and OrderItem, one
            # row per line item (order-level fields repeat across an
            # order's rows) so nothing from either table is left out. An
            # order with no items still gets one row with blank item columns.
            queryset = queryset.prefetch_related(items_prefetch)
            header = [
                "Order Number",
                "Status",
                "Customer Name",
                "Customer Phone",
                "Customer Email",
                "Secondary Phone",
                "Address Line 1",
                "Address Line 2",
                "City",
                "Country",
                "Postal Code",
                "CNIC",
                "Customer Tags",
                "Customer Type",
                "Payment Gateway",
                "Payment Status",
                "Fulfillment Status",
                "Shop",
                "Courier",
                "Tracking Number",
                "Issue Note",
                "Return Reason",
                "Order Source",
                "Shipping Type",
                "Total Amount",
                "Coupon Discount",
                "Gift Card Discount",
                "Loyalty Amount",
                "Wallet Amount",
                "Total Tax",
                "Donation Amount",
                "Shipping Amount",
                "Amount Paid",
                "Grand Total",
                "Amount Receivable",
                "Placed At",
                "Dispatched At",
                "Delivered At",
                "Returned At",
                "Created At",
                "Item Product Name",
                "Item Barcode",
                "Item Quantity",
                "Item Unit Price",
                "Item Vendor",
                "Item Discount Amount",
                "Item Weight Grams",
            ]

            def rows():
                yield header
                for order in queryset.iterator(chunk_size=500):
                    order_fields = [
                        order.order_number,
                        order.get_status_display(),
                        order.customer_name,
                        order.customer_phone,
                        order.customer_email,
                        order.secondary_phone,
                        order.address_line1,
                        order.address_line2,
                        order.city,
                        order.country,
                        order.postal_code,
                        order.cnic,
                        order.customer_tags,
                        order.customer_type,
                        order.payment_gateway,
                        order.payment_status,
                        order.fulfillment_status,
                        order.shop,
                        order.courier.name if order.courier_id else "",
                        order.tracking_number,
                        order.issue_note,
                        order.return_reason,
                        order.order_source,
                        order.shipping_type,
                        str(order.total_amount),
                        str(order.coupon_discount),
                        str(order.gift_card_discount),
                        str(order.loyalty_amount),
                        str(order.wallet_amount),
                        str(order.total_tax),
                        str(order.donation_amount),
                        str(order.shipping_amount),
                        str(order.amount_paid),
                        str(order.grand_total),
                        str(order.amount_receivable),
                        (order.placed_at or order.created_at).isoformat(),
                        order.dispatched_at.isoformat() if order.dispatched_at else "",
                        order.delivered_at.isoformat() if order.delivered_at else "",
                        order.returned_at.isoformat() if order.returned_at else "",
                        order.created_at.isoformat(),
                    ]
                    items = list(order.items.all())
                    if not items:
                        yield order_fields + ["", "", "", "", "", "", ""]
                        continue
                    for item in items:
                        yield order_fields + [
                            item.product_name,
                            item.barcode,
                            item.quantity,
                            str(item.unit_price),
                            item.vendor,
                            str(item.discount_amount),
                            item.weight_grams if item.weight_grams is not None else "",
                        ]

            filename = "orders_all.csv"

        writer = csv.writer(Echo())
        response = StreamingHttpResponse(
            (writer.writerow(row) for row in rows()), content_type="text/csv"
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class CourierViewSet(viewsets.ModelViewSet):
    serializer_class = CourierSerializer
    permission_classes = [RequireModule]
    required_module = "oms"

    def get_queryset(self):
        return Courier.objects.filter(organization_id=self.request.organization_id)

    def perform_create(self, serializer):
        serializer.save(organization_id=self.request.organization_id)
