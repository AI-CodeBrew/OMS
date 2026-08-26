from django.db.models import F, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from core.permissions import RequireModule
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


class ReturnRestockView(viewsets.ViewSet):
    """Returns-desk workflow: scan (or type) a returned order's number to
    put its units back into stock. Separate from the order's `returned`
    status - the courier reports the return when it leaves the customer,
    the goods physically arrive at the warehouse later, and only that
    second event should move inventory."""

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
        if not order:
            return Response(
                {"success": False, "reason": "not_found", "order_number": order_number}
            )
        if order.status != "returned":
            return Response(
                {
                    "success": False,
                    "reason": f"Order is {order.get_status_display()}, not Returned",
                    "order_number": order_number,
                }
            )

        movements = services.restock_from_return(
            order,
            actor_user_id=request.user_id,
            note=(request.data.get("note") or "")[:255],
        )
        if not movements:
            return Response(
                {
                    "success": False,
                    "reason": "Already restocked (or no SKUs on this order)",
                    "order_number": order_number,
                }
            )
        return Response(
            {
                "success": True,
                "order_number": order_number,
                "restocked": [
                    {"sku": m.stock_item.sku, "quantity": m.delta, "balance": m.balance_after}
                    for m in movements
                ],
            }
        )
