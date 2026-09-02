from django.db.models import F, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from core.permissions import RequireModule
from oms import services as oms_services
from oms.models import Order

from . import services
from .models import StockItem, StockMovement, Warehouse
from .serializers import StockItemSerializer, StockMovementSerializer, WarehouseSerializer


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
        serializer.save(organization_id=self.request.organization_id)


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

    @action(detail=False, methods=["get"])
    def summary(self, request):
        qs = StockItem.objects.filter(organization_id=request.organization_id)
        return Response(
            {
                "total_skus": qs.count(),
                "negative_count": qs.filter(quantity__lt=0).count(),
                "low_count": qs.filter(quantity__gte=0, quantity__lte=F("reorder_level")).count(),
            }
        )

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

    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        stock_item = self.get_object()
        try:
            delta = int(request.data.get("delta"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "delta must be a whole number"}, status=status.HTTP_400_BAD_REQUEST
            )
        if delta == 0:
            return Response({"detail": "delta cannot be zero"}, status=status.HTTP_400_BAD_REQUEST)

        services.adjust_stock(
            organization_id=request.organization_id,
            stock_item=stock_item,
            delta=delta,
            actor_user_id=request.user_id,
            note=(request.data.get("note") or "")[:255],
        )
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


def _orders_by_number(organization_id, order_numbers):
    """One query for a whole batch, keyed by order number - a bulk action
    over a page of selected rows shouldn't be a query per row."""
    orders = Order.objects.filter(
        organization_id=organization_id, order_number__in=order_numbers
    )
    return {order.order_number: order for order in orders}


def _lookup_return(order, order_number):
    """Read-only validation - the scan panel's first phase. Finds out
    whether a parcel is receivable at all, without recording anything, so
    the operator can be prompted for its condition (good/bad) before
    anything is written."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": order_number}
    if order.status != "returned":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Returned",
            "order_number": order_number,
        }
    if order.return_received_at:
        return {"success": False, "reason": "Already received", "order_number": order_number}
    return {"success": True, "order_number": order_number}


def _receive_return(order, order_number, *, condition, actor_user_id, actor_email="", note=""):
    """One order's worth of the returns-desk workflow, in the
    {success, order_number, reason} shape the scan panel renders. Shared
    by the single scan and the bulk action so both answer identically."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": order_number}
    if order.status != "returned":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Returned",
            "order_number": order_number,
        }

    movements = services.restock_from_return(
        order, condition=condition, actor_user_id=actor_user_id, actor_email=actor_email, note=note
    )
    if movements is None:
        return {"success": False, "reason": "Already received", "order_number": order_number}
    if condition == "bad":
        return {"success": True, "order_number": order_number, "condition": "bad", "restocked": []}
    return {
        "success": True,
        "order_number": order_number,
        "condition": "good",
        "restocked": [
            {"sku": m.stock_item.sku, "quantity": m.delta, "balance": m.balance_after}
            for m in movements
        ],
    }


class ReturnRestockView(viewsets.ViewSet):
    """Returns-desk workflow: scan (or type) a returned order's number to
    put its units back into stock. Separate from the order's `returned`
    status - the courier reports the return when it leaves the customer,
    the goods physically arrive at the warehouse later, and only that
    second event should move inventory."""

    permission_classes = [RequireModule]
    required_module = "wms"

    @action(detail=False, methods=["post"], url_path="lookup")
    def lookup(self, request):
        """Read-only - the scan panel's first phase. Confirms a parcel is
        receivable (green tick) before the operator is asked whether it
        arrived in good or bad condition; nothing is written here."""
        order_number = (request.data.get("order_number") or "").strip()
        if not order_number:
            return Response(
                {"detail": "order_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        order = Order.objects.filter(
            organization_id=request.organization_id, order_number=order_number
        ).first()
        return Response(_lookup_return(order, order_number))

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        order_number = (request.data.get("order_number") or "").strip()
        condition = (request.data.get("condition") or "").strip()
        if not order_number:
            return Response(
                {"detail": "order_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        if condition not in ("good", "bad"):
            return Response(
                {"detail": "condition must be 'good' or 'bad'"}, status=status.HTTP_400_BAD_REQUEST
            )

        order = Order.objects.filter(
            organization_id=request.organization_id, order_number=order_number
        ).first()
        return Response(
            _receive_return(
                order,
                order_number,
                condition=condition,
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                note=(request.data.get("note") or "")[:255],
            )
        )

    @action(detail=False, methods=["post"], url_path="bulk-receive")
    def bulk_receive(self, request):
        """Receives a whole selection at once, all under the same
        condition - a mixed-condition batch is scanned individually
        instead. Each order is reported individually rather than failing
        the batch - a selection that includes one already-received
        parcel should still receive the rest."""
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

        found = _orders_by_number(request.organization_id, order_numbers)
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


def _pack_order(order, order_number, *, actor_user_id, actor_email=""):
    """Strict by design: only an order actually sitting in Ready to Pick
    can be packed. Anything else comes back as a failure the scan panel
    shows as a red cross, rather than quietly skipping a pipeline stage."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": order_number}
    if order.status != "ready_to_pick":
        return {
            "success": False,
            "reason": f"Order is {order.get_status_display()}, not Ready to Pick",
            "order_number": order_number,
        }

    oms_services.queue_for_dispatch(order, actor_user_id=actor_user_id)
    order.packed_at = timezone.now()
    order.packed_by_email = actor_email or ""
    order.save(update_fields=["packed_at", "packed_by_email", "updated_at"])
    return {"success": True, "order_number": order_number, "status": order.status}


class PackingView(viewsets.ViewSet):
    """Packing station. The queue is simply the orders sitting in the OMS
    `ready_to_pick` status - there's no separate packing record to keep in
    step, the two views read the same status.

    Deliberately does not touch stock: units are consumed at booking time
    (see oms.services.push_order_to_smartlane -> wms.services.
    consume_for_order), long before a parcel reaches the packing bench, so
    deducting again here would double-count.
    """

    permission_classes = [RequireModule]
    required_module = "wms"

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        order_number = (request.data.get("order_number") or "").strip()
        if not order_number:
            return Response(
                {"detail": "order_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        order = Order.objects.filter(
            organization_id=request.organization_id, order_number=order_number
        ).first()
        return Response(
            _pack_order(
                order,
                order_number,
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

        found = _orders_by_number(request.organization_id, order_numbers)
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
