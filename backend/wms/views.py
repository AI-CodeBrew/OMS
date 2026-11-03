import csv

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from core.permissions import RequireAnyModule, RequireModule
from core.scoping import org_filter
from integrations.models import ShopifyConnection
from integrations.services import pending_push_queryset
from oms import services as oms_services
from oms.models import Order

from . import services
from .models import PurchaseOrder, StockItem, StockMovement, Supplier, Warehouse
from .serializers import (
    PurchaseOrderSerializer,
    StockItemSerializer,
    StockMovementSerializer,
    SupplierSerializer,
    WarehouseSerializer,
)


class WmsPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 500


class WarehouseViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    permission_classes = [RequireModule]
    required_module = "wms"

    def get_queryset(self):
        return Warehouse.objects.filter(organization_id=self.request.organization_id)

    def perform_create(self, serializer):
        # Add Warehouse (Purchase Orders page) asks for no code - one is made
        # from the name, unique within the store. The store's first
        # warehouse is its default.
        existing = Warehouse.objects.filter(organization_id=self.request.organization_id)
        code = (serializer.validated_data.get("code") or "").strip()
        if not code:
            base = slugify(serializer.validated_data.get("name") or "warehouse").upper()[:40] or "WAREHOUSE"
            code, n = base, 2
            while existing.filter(code=code).exists():
                code, n = f"{base}-{n}", n + 1
        extra = {} if existing.exists() else {"is_default": True}
        serializer.save(organization_id=self.request.organization_id, code=code, **extra)


class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    permission_classes = [RequireModule]
    required_module = "wms"

    def get_queryset(self):
        return Supplier.objects.filter(organization_id=self.request.organization_id)

    def perform_create(self, serializer):
        if not (serializer.validated_data.get("name") or "").strip():
            raise ValidationError({"name": "Name is required."})
        serializer.save(organization_id=self.request.organization_id)


class PurchaseOrderViewSet(viewsets.ReadOnlyModelViewSet):
    """The Purchase Orders page. Created and received through the actions
    below (wms.services), which add the good units to stock."""

    serializer_class = PurchaseOrderSerializer
    permission_classes = [RequireModule]
    required_module = "wms"
    pagination_class = WmsPagination

    def _base_qs(self):
        received = Coalesce(Sum(F("lines__good_received") + F("lines__damaged_received")), 0)
        return PurchaseOrder.objects.filter(organization_id=self.request.organization_id).annotate(
            _total=Coalesce(Sum("lines__quantity_ordered"), 0), _received=received
        )

    def _state_filter(self, qs, state):
        if state == "not_received":
            return qs.filter(_received=0)
        if state == "partial":
            return qs.filter(_received__gt=0, _received__lt=F("_total"))
        if state == "received":
            return qs.filter(_received__gt=0, _received__gte=F("_total"))
        return qs

    def get_queryset(self):
        params = self.request.query_params
        qs = self._state_filter(self._base_qs(), params.get("state"))
        search = (params.get("search") or "").strip()
        if search:
            condition = Q(supplier__name__icontains=search) | Q(lines__sku__icontains=search)
            digits = search.upper().removeprefix("PO-").lstrip("0")
            if digits.isdigit():
                condition |= Q(number=int(digits))
            qs = qs.filter(id__in=PurchaseOrder.objects.filter(condition).values("id"))
        return qs.select_related("supplier", "warehouse").prefetch_related("lines")

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = self._base_qs()
        return Response(
            {
                "total": qs.count(),
                "received": self._state_filter(qs, "received").count(),
                "partial": self._state_filter(qs, "partial").count(),
                "not_received": self._state_filter(qs, "not_received").count(),
            }
        )

    def create(self, request, *args, **kwargs):
        data = request.data
        supplier = Supplier.objects.filter(
            organization_id=request.organization_id, id=data.get("supplier")
        ).first()
        warehouse = Warehouse.objects.filter(
            organization_id=request.organization_id, id=data.get("warehouse")
        ).first()
        if supplier is None or warehouse is None:
            return Response(
                {"detail": "Pick a supplier and a receiving warehouse."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ordered_at = parse_datetime(data.get("ordered_at") or "") if data.get("ordered_at") else None
        try:
            po = services.create_purchase_order(
                organization_id=request.organization_id,
                supplier=supplier,
                warehouse=warehouse,
                ordered_at=ordered_at,
                lines=[row for row in (data.get("lines") or []) if isinstance(row, dict)],
                note=data.get("note") or "",
                actor_user_id=request.user_id,
            )
        except services.PurchaseOrderError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self.get_queryset().get(id=po.id)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        """Another delivery: {receipts: [{line, good, damaged}]}, added to
        what's already received - good units go into stock."""
        po = self.get_object()
        receipts = {
            str(row.get("line")): row
            for row in (request.data.get("receipts") or [])
            if isinstance(row, dict) and row.get("line")
        }
        try:
            services.receive_purchase_order(po, receipts, actor_user_id=request.user_id)
        except services.PurchaseOrderError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self.get_queryset().get(id=po.id)).data)

    @action(detail=False, methods=["get"])
    def product(self, request):
        """Add PO's autofill: the stock item with exactly this SKU (name and
        Shopify image), or 404."""
        sku = (request.query_params.get("sku") or "").strip()
        item = (
            StockItem.objects.filter(organization_id=request.organization_id, sku__iexact=sku)
            .exclude(sku="")
            .order_by(F("shopify_inventory_item_id").asc(nulls_last=True))
            .first()
            if sku
            else None
        )
        if item is None:
            return Response({"detail": "No product with that SKU."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"sku": item.sku, "product_name": item.product_name, "image_url": item.image_url})

    @action(detail=False, methods=["post"], url_path="sync-shopify")
    def sync_shopify(self, request):
        """Sync from Shopify: every product and its stock (the Inventory
        page's own sync), then each one's first image."""
        from integrations.services import (
            InventorySyncError,
            sync_inventory_from_shopify,
            sync_product_images_from_shopify,
        )

        try:
            result = sync_inventory_from_shopify(request.organization_id)
            result.update(sync_product_images_from_shopify(request.organization_id))
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001 - surface Shopify API failures to the user, not a 500
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)


class StockItemViewSet(viewsets.ModelViewSet):
    serializer_class = StockItemSerializer
    permission_classes = [RequireModule]
    required_module = "wms"
    pagination_class = WmsPagination

    def get_queryset(self):
        qs = StockItem.objects.filter(
            organization_id=self.request.organization_id
        ).select_related("warehouse")
        params = self.request.query_params

        search = params.get("search")
        if search:
            qs = qs.filter(Q(sku__icontains=search) | Q(product_name__icontains=search))

        warehouse_id = params.get("warehouse_id")
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)

        # "alert" surfaces exactly what the WMS screen highlights: stock
        # that went negative (an order shipped units the warehouse didn't
        # have) or dropped to its reorder threshold.
        stock_filter = params.get("stock_filter")
        if stock_filter == "negative":
            qs = qs.filter(quantity__lt=0)
        elif stock_filter == "low":
            qs = qs.filter(quantity__gte=0, quantity__lte=F("reorder_level"))
        return qs

    def perform_create(self, serializer):
        serializer.save(organization_id=self.request.organization_id)

    def _scoped_movements(self, request):
        movements = StockMovement.objects.filter(organization_id=request.organization_id)
        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if date_from:
            movements = movements.filter(created_at__date__gte=date_from)
        if date_to:
            movements = movements.filter(created_at__date__lte=date_to)
        return movements

    @action(detail=False, methods=["get"])
    def summary(self, request):
        # "export=csv" not "format=csv" - see oms.views.ReportView.get for
        # why (DRF's own content-negotiation reserves "format").
        if request.query_params.get("export") == "csv":
            return self._csv(request)

        qs = StockItem.objects.filter(organization_id=request.organization_id)

        # On-hand snapshot (negative/low) is always "right now" - a stock
        # level has no meaningful "as of last week" reading. The movement
        # totals below are the date-range-scoped part, for the Report page.
        movements = self._scoped_movements(request)

        # delta is negative for dispatch (stock leaving) and positive for a
        # return restock (stock coming back) - see StockMovement.delta.
        dispatched = movements.filter(reason="order_dispatch").aggregate(total=Sum("delta"))["total"] or 0
        restocked = movements.filter(reason="return_restock").aggregate(total=Sum("delta"))["total"] or 0

        return Response(
            {
                "total_skus": qs.count(),
                "negative_count": qs.filter(quantity__lt=0).count(),
                "low_count": qs.filter(quantity__gte=0, quantity__lte=F("reorder_level")).count(),
                "units_dispatched": abs(dispatched),
                "units_restocked": restocked,
                "manual_adjustments": movements.filter(reason="manual_adjustment").count(),
                "pending_shopify_count": pending_push_queryset(request.organization_id).count(),
                "shopify_connected": ShopifyConnection.objects.filter(
                    organization_id=request.organization_id, is_connected=True
                ).exists(),
            }
        )

    def _csv(self, request):
        movements = self._scoped_movements(request).annotate(_date=TruncDate("created_at"))
        by_day = (
            movements.values("_date", "reason")
            .annotate(total=Sum("delta"), n=Count("id"))
            .order_by("_date")
        )
        rows_by_date = {}
        for row in by_day:
            rows_by_date.setdefault(row["_date"], {})[row["reason"]] = row

        header = ["Date", "Units Dispatched", "Units Restocked", "Manual Adjustments (count)"]

        def rows():
            yield header
            for date, reasons in sorted(rows_by_date.items(), key=lambda kv: (kv[0] is None, kv[0])):
                dispatched = abs((reasons.get("order_dispatch") or {}).get("total") or 0)
                restocked = (reasons.get("return_restock") or {}).get("total") or 0
                adjustments = (reasons.get("manual_adjustment") or {}).get("n") or 0
                yield [date.isoformat() if date else "", dispatched, restocked, adjustments]

        class Echo:
            def write(self, value):
                return value

        writer = csv.writer(Echo())
        response = StreamingHttpResponse(
            (writer.writerow(row) for row in rows()), content_type="text/csv"
        )
        date_from = request.query_params.get("date_from") or "all"
        date_to = request.query_params.get("date_to") or "all"
        response["Content-Disposition"] = f'attachment; filename="wms_report_{date_from}_to_{date_to}.csv"'
        return response

    @action(detail=False, methods=["get"])
    def overview(self, request):
        """The Inventory page's table and cards (services.inventory_overview),
        paginated here since its numbers are worked out per item."""
        params = request.query_params
        rows, summary = services.inventory_overview(
            request.organization_id, search=params.get("search") or "", activity=params.get("activity") or ""
        )
        try:
            page_size = min(max(int(params.get("page_size") or 25), 1), 500)
            page = max(int(params.get("page") or 1), 1)
        except ValueError:
            page_size, page = 25, 1
        start = (page - 1) * page_size
        return Response({"count": len(rows), "results": rows[start : start + page_size], "summary": summary})

    @action(detail=True, methods=["get"])
    def report(self, request, pk=None):
        """One item's details - the eye icon - or, with export=csv, the
        same as a downloadable report."""
        item = self.get_object()
        report = services.inventory_item_report(item)
        if request.query_params.get("export") != "csv":
            return Response(report)

        row = report["item"]

        def lines():
            yield ["Inventory report", row["sku"] or row["product_name"]]
            yield ["Product", row["product_name"]]
            yield ["Warehouse", row["warehouse_name"]]
            yield ["Generated", timezone.localtime().strftime("%Y-%m-%d %H:%M")]
            yield []
            for label, key in (
                ("Total inbound (PO good)", "total_inbound"),
                ("Available stock", "available"),
                ("Delivered", "delivered"),
                ("Dispatched", "dispatched"),
                ("Failed delivery", "failed_delivery"),
                ("Return in transit", "return_in_transit"),
                ("Damaged (returns)", "returns_damaged"),
                ("Lost (returns)", "returns_lost"),
                ("Damaged (purchase orders)", "po_damaged"),
            ):
                yield [label, row[key]]
            yield []
            yield ["Orders"]
            yield ["Order", "Customer", "Order Date", "Created At", "Total", "Courier", "Tracking", "Status", "Quantity"]
            for o in report["orders"]:
                status_label = o["status_label"] + (" (return in transit)" if o["returning"] else "")
                yield [
                    o["order_number"], o["customer_name"],
                    o["date"].strftime("%Y-%m-%d %H:%M") if o["date"] else "",
                    o["created_at"].strftime("%Y-%m-%d %H:%M") if o["created_at"] else "",
                    o["total"], o["courier"], o["tracking_number"], status_label, o["quantity"],
                ]
            yield []
            yield ["Purchase orders"]
            yield ["PO", "Supplier", "Date", "Ordered", "Good", "Damaged", "Unit price"]
            for p in report["purchases"]:
                yield [p["po_number"], p["supplier"], p["ordered_at"].strftime("%Y-%m-%d %H:%M"), p["quantity_ordered"], p["good"], p["damaged"], p["unit_price"]]
            yield []
            yield ["Stock movements"]
            yield ["Date", "Reason", "Change", "Balance", "Reference", "Note"]
            for m in report["movements"]:
                yield [m["date"].strftime("%Y-%m-%d %H:%M"), m["reason"], m["delta"], m["balance_after"], m["reference"], m["note"]]

        class Echo:
            def write(self, value):
                return value

        writer = csv.writer(Echo())
        response = StreamingHttpResponse((writer.writerow(r) for r in lines()), content_type="text/csv")
        name = slugify(row["sku"] or row["product_name"] or "item") or "item"
        response["Content-Disposition"] = f'attachment; filename="inventory_{name}.csv"'
        return response

    @action(detail=False, methods=["post"], url_path="import-skus")
    def import_skus(self, request):
        warehouse = services.get_default_warehouse(request.organization_id)
        if warehouse is None:
            return Response(
                {"detail": "Create a warehouse first"}, status=status.HTTP_400_BAD_REQUEST
            )
        result = services.import_skus_from_orders(
            organization_id=request.organization_id, warehouse=warehouse
        )
        return Response(result)

    @action(detail=False, methods=["post"], url_path="sync-shopify")
    def sync_shopify(self, request):
        """Real on-hand quantities from Shopify - unlike import-skus above
        (which only discovers SKU names from order history and seeds them
        at zero), this actually fetches current stock levels."""
        from integrations.services import InventorySyncError, sync_inventory_from_shopify

        try:
            result = sync_inventory_from_shopify(request.organization_id)
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001 - surface Shopify API failures to the user, not a 500
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)

    @action(detail=False, methods=["get"], url_path="shopify-pending")
    def shopify_pending(self, request):
        """The confirmation summary for Push to Shopify - every rename and
        stock adjustment that hasn't reached Shopify yet."""
        from integrations.services import InventorySyncError, pending_shopify_changes

        try:
            return Response(pending_shopify_changes(request.organization_id))
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="create-on-shopify")
    def create_on_shopify(self, request):
        """Add Stock Item with "Also create on Shopify" - multipart, so
        product images can come along. Name, SKU, price and quantity are
        required; images are optional."""
        from decimal import Decimal, InvalidOperation

        from integrations.services import InventorySyncError, create_stock_item_on_shopify

        data = request.data
        sku = (data.get("sku") or "").strip()
        name = (data.get("product_name") or "").strip()
        if not sku or not name:
            return Response({"detail": "Product name and SKU are required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(sku) > 100 or len(name) > 255:
            return Response({"detail": "SKU or product name is too long"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            price = Decimal(str(data.get("price") or "")).quantize(Decimal("0.01"))
        except InvalidOperation:
            return Response({"detail": "Enter a valid price"}, status=status.HTTP_400_BAD_REQUEST)
        if price <= 0:
            return Response({"detail": "Price must be more than zero"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            quantity = int(data.get("quantity"))
            reorder_level = int(data.get("reorder_level") or 0)
        except (TypeError, ValueError):
            return Response({"detail": "Quantity must be a whole number"}, status=status.HTTP_400_BAD_REQUEST)
        if quantity < 0 or reorder_level < 0:
            return Response({"detail": "Quantity cannot be negative"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            item, warning = create_stock_item_on_shopify(
                request.organization_id,
                sku=sku,
                name=name,
                price=price,
                quantity=quantity,
                reorder_level=reorder_level,
                images=request.FILES.getlist("images"),
                actor_user_id=request.user_id,
            )
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"item": self.get_serializer(item).data, "warning": warning},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="push-shopify")
    def push_shopify(self, request):
        """Sends one batch of confirmed changes (the summary's `expected`
        values, as {id, delta, name}) - the opposite direction to
        sync-shopify above, which only ever imports."""
        from integrations.services import (
            InventorySyncError,
            PushConflict,
            push_stock_changes_to_shopify,
        )

        changes = request.data.get("changes")
        if not isinstance(changes, list) or not changes:
            return Response({"detail": "changes is required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(changes) > 25:
            return Response(
                {"detail": "Send at most 25 changes per request"}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            result = push_stock_changes_to_shopify(
                request.organization_id, changes, actor_user_id=request.user_id
            )
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except PushConflict as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(result)

    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        """Stock delta and/or a product rename from the Adjust popup - at
        least one is required. Both are saved together or not at all."""
        stock_item = self.get_object()

        raw_delta = request.data.get("delta")
        delta = None
        if raw_delta not in (None, ""):
            try:
                delta = int(raw_delta)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "delta must be a whole number"}, status=status.HTTP_400_BAD_REQUEST
                )
            if delta == 0:
                return Response({"detail": "delta cannot be zero"}, status=status.HTTP_400_BAD_REQUEST)

        product_name = request.data.get("product_name")
        if product_name is not None:
            product_name = str(product_name).strip()
            if not product_name:
                return Response(
                    {"detail": "Product name cannot be blank"}, status=status.HTTP_400_BAD_REQUEST
                )
            if len(product_name) > 255:
                return Response(
                    {"detail": "Product name is too long (255 characters max)"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if product_name == stock_item.product_name:
                product_name = None

        if delta is None and product_name is None:
            return Response(
                {"detail": "Enter a quantity or change the product name"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            if product_name is not None:
                services.rename_stock_item(
                    organization_id=request.organization_id,
                    stock_item=stock_item,
                    product_name=product_name,
                    actor_user_id=request.user_id,
                )
                stock_item.refresh_from_db()
            if delta is not None:
                services.adjust_stock(
                    organization_id=request.organization_id,
                    stock_item=stock_item,
                    delta=delta,
                    actor_user_id=request.user_id,
                    note=(request.data.get("note") or "")[:255],
                )
        stock_item.refresh_from_db()
        return Response(self.get_serializer(stock_item).data)


class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only by design - the ledger is written by services (dispatch,
    restock, adjustment), never edited directly."""

    serializer_class = StockMovementSerializer
    permission_classes = [RequireModule]
    required_module = "wms"
    pagination_class = WmsPagination

    def get_queryset(self):
        qs = StockMovement.objects.filter(
            organization_id=self.request.organization_id
        ).select_related("stock_item")
        sku = self.request.query_params.get("sku")
        if sku:
            qs = qs.filter(stock_item__sku=sku)
        order_number = self.request.query_params.get("order_number")
        if order_number:
            qs = qs.filter(order_number=order_number)
        return qs


def _orders_by_number(org_kwargs, order_numbers):
    """One query for a whole batch, keyed by order number - a bulk action
    over a page of selected rows shouldn't be a query per row. Used by the
    table's own bulk-select actions, which already know exactly which
    orders they mean - unlike a scan, there's no barcode to resolve.

    `org_kwargs` is core.scoping.org_filter(request)'s dict - one store
    normally, every Dispatch Hub store when a super admin is operating
    several at once (safe here either way: every downstream service call
    below derives its own org from the Order row, never from request/
    ambient context, so an order from any matched store works unmodified).
    """
    orders = Order.objects.filter(order_number__in=order_numbers, **org_kwargs)
    return {order.order_number: order for order in orders}


def _find_order(org_kwargs, request_data):
    """Resolves the order a scan/manual-entry or a table action refers to.

    The physical label on a parcel carries the courier's tracking number
    (that's literally what its barcode encodes), so the scan panel sends
    tracking_number. The orders table already displays order_number and
    knows exactly which row a button belongs to, so its buttons send that
    instead - no barcode involved, nothing to resolve by scanning.

    Returns (order_or_None, raw_identifier) - raw_identifier is whatever
    string was searched by, used only to label a not_found result (there's
    no order to pull a real order_number from in that case).
    """
    tracking_number = (request_data.get("tracking_number") or "").strip()
    if tracking_number:
        order = Order.objects.filter(tracking_number=tracking_number, **org_kwargs).first()
        return order, tracking_number

    order_number = (request_data.get("order_number") or "").strip()
    order = Order.objects.filter(order_number=order_number, **org_kwargs).first()
    return order, order_number


def _lookup_return(order, raw_identifier):
    """Read-only validation - the scan panel's first phase. Finds out
    whether a parcel is receivable at all, without recording anything, so
    the operator can be prompted for its condition (good/bad) before
    anything is written."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": raw_identifier}
    if order.status != "returned":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Returned",
            "order_number": order.order_number,
        }
    if order.return_received_at:
        return {"success": False, "reason": "Already received", "order_number": order.order_number}
    return {
        "success": True,
        "order_number": order.order_number,
        "tracking_number": order.tracking_number,
        # The popup's rows - each line's units start as Good.
        "lines": services.return_line_summary(order),
    }


def _receive_return(
    order, raw_identifier, *, condition="good", counts=None, actor_user_id, actor_email="", note=""
):
    """One order's worth of the returns-desk workflow, in the
    {success, order_number, reason} shape the scan panel renders. Shared
    by the single scan and the bulk action so both answer identically.
    Once an order is found, responses always key off its real
    order_number for display, regardless of whether it was looked up by
    tracking number or order number."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": raw_identifier}
    if order.status != "returned":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Returned",
            "order_number": order.order_number,
        }

    try:
        breakdown = services.build_return_breakdown(order, counts, condition=condition)
    except services.InvalidReturnBreakdown as exc:
        return {"success": False, "reason": str(exc), "order_number": order.order_number}

    unmatched = []
    movements = services.restock_from_return(
        order,
        breakdown=breakdown,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        note=note,
        unmatched=unmatched,
    )
    if movements is None:
        return {"success": False, "reason": "Already received", "order_number": order.order_number}
    return {
        "success": True,
        "order_number": order.order_number,
        "condition": order.return_condition,
        "breakdown": breakdown,
        "restocked": [
            {
                "sku": m.stock_item.sku,
                "product_name": m.stock_item.product_name,
                "quantity": m.delta,
                "balance": m.balance_after,
            }
            for m in movements
        ],
        # Received, but no stock item to put these back on - the desk shows
        # them so nobody assumes inventory moved.
        "not_restocked": unmatched,
    }


class ReturnRestockView(viewsets.ViewSet):
    """Returns-desk workflow: scan (or type) a returned parcel's tracking
    number to put its units back into stock. Separate from the order's
    `returned` status - the courier reports the return when it leaves the
    customer, the goods physically arrive at the warehouse later, and
    only that second event should move inventory."""

    # Also the Returns Associate's page (staff role "returns").
    permission_classes = [RequireAnyModule]
    required_any_module = ("wms", "returns")

    @action(detail=False, methods=["post"], url_path="lookup")
    def lookup(self, request):
        """Read-only - the scan panel's first phase. Confirms a parcel is
        receivable (green tick) before the operator is asked whether it
        arrived in good or bad condition; nothing is written here."""
        if not (request.data.get("tracking_number") or request.data.get("order_number")):
            return Response(
                {"detail": "tracking_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        order, raw_identifier = _find_order(org_filter(request), request.data)
        return Response(_lookup_return(order, raw_identifier))

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        """Receives one parcel. `breakdown` is the popup's count per line -
        [{key, good, damaged, lost}] - and only good units are restocked.
        Without it, `condition` ("good"/"bad") applies to every unit."""
        condition = (request.data.get("condition") or "good").strip()
        raw_breakdown = request.data.get("breakdown")
        if not (request.data.get("tracking_number") or request.data.get("order_number")):
            return Response(
                {"detail": "tracking_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        counts = None
        if raw_breakdown is not None:
            if not isinstance(raw_breakdown, list):
                return Response(
                    {"detail": "breakdown must be a list"}, status=status.HTTP_400_BAD_REQUEST
                )
            counts = {
                str(row.get("key")): row for row in raw_breakdown if isinstance(row, dict)
            }
        elif condition not in ("good", "bad"):
            return Response(
                {"detail": "condition must be 'good' or 'bad'"}, status=status.HTTP_400_BAD_REQUEST
            )

        order, raw_identifier = _find_order(org_filter(request), request.data)
        return Response(
            _receive_return(
                order,
                raw_identifier,
                condition=condition,
                counts=counts,
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                note=(request.data.get("note") or "")[:255],
            )
        )

    @action(detail=False, methods=["post"], url_path="bulk-receive")
    def bulk_receive(self, request):
        """Receives a whole selection at once, all under the same
        condition - a mixed-condition batch is scanned individually
        instead. Selected from the orders table, so this is always by
        order_number, never a barcode. Each order is reported
        individually rather than failing the batch - a selection that
        includes one already-received parcel should still receive the
        rest."""
        order_numbers = [
            str(n).strip() for n in (request.data.get("order_numbers") or []) if str(n).strip()
        ]
        condition = (request.data.get("condition") or "").strip()
        if not order_numbers:
            return Response(
                {"detail": "order_numbers is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        if condition not in ("good", "bad"):
            return Response(
                {"detail": "condition must be 'good' or 'bad'"}, status=status.HTTP_400_BAD_REQUEST
            )

        found = _orders_by_number(org_filter(request), order_numbers)
        note = (request.data.get("note") or "")[:255]
        actor_email = getattr(request, "auth_email", "") or ""
        results = [
            _receive_return(
                found.get(number),
                number,
                condition=condition,
                actor_user_id=request.user_id,
                actor_email=actor_email,
                note=note,
            )
            for number in order_numbers
        ]
        return Response({"results": results})


def _pack_order(order, raw_identifier, *, actor_user_id, actor_email=""):
    """Strict by design: only an order actually sitting in Ready to Pick
    can be packed. Anything else comes back as a failure the scan panel
    shows as a red cross, rather than quietly skipping a pipeline stage."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": raw_identifier}
    if order.status != "ready_to_pick":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Ready to Pick",
            "order_number": order.order_number,
        }

    oms_services.queue_for_dispatch(order, actor_user_id=actor_user_id)
    order.packed_at = timezone.now()
    order.packed_by_email = actor_email or ""
    order.save(update_fields=["packed_at", "packed_by_email", "updated_at"])
    return {"success": True, "order_number": order.order_number, "status": order.status}


class PackingView(viewsets.ViewSet):
    """Packing station. The queue is simply the orders sitting in the OMS
    `ready_to_pick` status - there's no separate packing record to keep in
    step, the two views read the same status.

    Deliberately does not touch stock: units are consumed at booking time
    (see oms.services.push_order_to_smartlane -> wms.services.
    consume_for_order), long before a parcel reaches the packing bench, so
    deducting again here would double-count.
    """

    # Also the Returns Associate's page (staff role "returns").
    permission_classes = [RequireAnyModule]
    required_any_module = ("wms", "returns")

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        if not (request.data.get("tracking_number") or request.data.get("order_number")):
            return Response(
                {"detail": "tracking_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        order, raw_identifier = _find_order(org_filter(request), request.data)
        return Response(
            _pack_order(
                order,
                raw_identifier,
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
            )
        )

    @action(detail=False, methods=["post"], url_path="bulk-pack")
    def bulk_pack(self, request):
        order_numbers = [
            str(n).strip() for n in (request.data.get("order_numbers") or []) if str(n).strip()
        ]
        if not order_numbers:
            return Response(
                {"detail": "order_numbers is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        found = _orders_by_number(org_filter(request), order_numbers)
        actor_email = getattr(request, "auth_email", "") or ""
        results = [
            _pack_order(
                found.get(number),
                number,
                actor_user_id=request.user_id,
                actor_email=actor_email,
            )
            for number in order_numbers
        ]
        return Response({"results": results})
