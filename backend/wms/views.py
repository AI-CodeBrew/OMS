import csv
import uuid

from django.db import transaction
from django.db.models import Count, F, Max, Q, Sum, prefetch_related_objects
from django.db.models.functions import Coalesce, TruncDate
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify
from rest_framework.exceptions import ValidationError
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from core.permissions import RequireAnyModule, RequireModule
from core.scoping import org_filter
from integrations.models import ShopifyConnection
from integrations.services import pending_push_queryset
from oms import services as oms_services
from oms.models import Order

from . import services
from .models import PurchaseOrder, PurchaseOrderLine, StockItem, StockMovement, Supplier, Warehouse
from .serializers import (
    PurchaseOrderSerializer,
    StockItemSerializer,
    StockMovementSerializer,
    SupplierSerializer,
    WarehouseSerializer,
)


def _stock_org(request):
    """Whose inventory this request works on: the organization's main store
    for a store inside an organization (its stores share one inventory -
    core.org_group), else the store itself."""
    return services.stock_org_id(request.organization_id)


class WmsPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 500


class WarehouseViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    permission_classes = [RequireAnyModule]
    # IMS (Inventory / Purchase Orders); "wms" too, for staff from before IMS.
    required_any_module = ("ims", "wms")
    page_access = {"*": {"read": ("ims.inventory", "ims.purchase_orders", "wms.packing", "wms.returns_desk", "reports"),
                         "write": ("ims.inventory", "ims.purchase_orders")}}

    def get_queryset(self):
        return Warehouse.objects.filter(organization_id=_stock_org(self.request))

    def perform_create(self, serializer):
        # Warehouse codes are numbers: left out (Add Warehouse asks for
        # none), the store's next one - 1, 2, 3 ... The store's first
        # warehouse is its default.
        existing = Warehouse.objects.filter(organization_id=_stock_org(self.request))
        code = (serializer.validated_data.get("code") or "").strip()
        if code and existing.filter(code=code).exists():
            raise ValidationError({"code": [f"Warehouse code {code} is already used."]})
        if not code:
            numbers = [int(c) for c in existing.values_list("code", flat=True) if (c or "").isdigit()]
            code = str(max(numbers, default=0) + 1)
        extra = {} if existing.exists() else {"is_default": True}
        serializer.save(organization_id=_stock_org(self.request), code=code, **extra)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """The Warehouses page (IMS): every warehouse with its stock and
        purchase-order totals. Three grouped queries (stock rows, POs, PO
        lines) - kept apart so one join can't multiply another's sums."""
        org = _stock_org(request)
        stock = {
            r["warehouse_id"]: r
            for r in StockItem.objects.filter(organization_id=org).values("warehouse_id").annotate(
                products=Count("id"),
                units=Coalesce(Sum("quantity", filter=Q(quantity__gt=0)), 0),
                below_zero=Count("id", filter=Q(quantity__lt=0)),
            )
        }
        pos = {
            r["warehouse_id"]: r
            for r in PurchaseOrder.objects.filter(organization_id=org).values("warehouse_id").annotate(
                count=Count("id"), last=Max("ordered_at")
            )
        }
        received = {
            r["purchase_order__warehouse_id"]: r
            for r in PurchaseOrderLine.objects.filter(organization_id=org)
            .values("purchase_order__warehouse_id")
            .annotate(good=Coalesce(Sum("good_received"), 0), damaged=Coalesce(Sum("damaged_received"), 0))
        }
        rows = []
        for warehouse in self.get_queryset().order_by("-is_default", "name"):
            s, p, r = stock.get(warehouse.id, {}), pos.get(warehouse.id, {}), received.get(warehouse.id, {})
            rows.append({
                **WarehouseSerializer(warehouse).data,
                "products": s.get("products", 0),
                "units_on_hand": s.get("units", 0),
                "products_below_zero": s.get("below_zero", 0),
                "purchase_orders": p.get("count", 0),
                "last_purchase_order_at": p.get("last"),
                "good_received": r.get("good", 0),
                "damaged_received": r.get("damaged", 0),
            })
        return Response(rows)


class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    permission_classes = [RequireAnyModule]
    # IMS (Inventory / Purchase Orders); "wms" too, for staff from before IMS.
    required_any_module = ("ims", "wms")
    page_access = {"*": {"read": ("ims.purchase_orders", "ims.inventory"), "write": ("ims.purchase_orders",)}}

    def get_queryset(self):
        return Supplier.objects.filter(organization_id=_stock_org(self.request))

    def perform_create(self, serializer):
        if not (serializer.validated_data.get("name") or "").strip():
            raise ValidationError({"name": "Name is required."})
        serializer.save(organization_id=_stock_org(self.request))


class PurchaseOrderViewSet(viewsets.ReadOnlyModelViewSet):
    """The Purchase Orders page. Created and received through the actions
    below (wms.services), which add the good units to stock."""

    serializer_class = PurchaseOrderSerializer
    permission_classes = [RequireAnyModule]
    # IMS (Inventory / Purchase Orders); "wms" too, for staff from before IMS.
    required_any_module = ("ims", "wms")
    page_access = {"*": {"read": ("ims.purchase_orders", "ims.inventory", "reports"),
                         "write": ("ims.purchase_orders",)}}
    pagination_class = WmsPagination

    def _base_qs(self):
        received = Coalesce(Sum(F("lines__good_received") + F("lines__damaged_received")), 0)
        return PurchaseOrder.objects.filter(organization_id=_stock_org(self.request)).annotate(
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
            organization_id=_stock_org(request), id=data.get("supplier")
        ).first()
        warehouse = Warehouse.objects.filter(
            organization_id=_stock_org(request), id=data.get("warehouse")
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
                logistics_cost=data.get("logistics_cost") or 0,
                actor_user_id=request.user_id,
            )
        except services.PurchaseOrderError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self.get_queryset().get(id=po.id)).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="import-template")
    def import_template(self, request):
        """The PO Import file to fill in - the columns and two example POs
        (wms.po_import)."""
        from . import po_import

        class Echo:
            def write(self, value):
                return value

        writer = csv.writer(Echo())
        response = StreamingHttpResponse(
            ("﻿" if i == 0 else "") + writer.writerow(row) for i, row in enumerate(po_import.template_rows())
        )
        response["Content-Type"] = "text/csv; charset=utf-8"
        response["Content-Disposition"] = 'attachment; filename="po_import_template.csv"'
        return response

    @action(detail=False, methods=["post"], url_path="import", parser_classes=[MultiPartParser, FormParser])
    def import_pos(self, request):
        """Creates many POs from one CSV (wms.po_import) - good units go
        into stock. A dry run unless apply=true."""
        from . import po_import

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Attach a CSV file as 'file'"}, status=status.HTTP_400_BAD_REQUEST)
        apply = str(request.data.get("apply", "")).lower() in ("1", "true", "yes")
        try:
            result = po_import.run_import(
                request.organization_id, upload, apply=apply, actor_user_id=request.user_id
            )
        except po_import.PoImportError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if result.get("error"):
            return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

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
        # Editable on Receive: the logistics cost and each product's cost.
        unit_prices = request.data.get("unit_prices") or {}
        if not isinstance(unit_prices, dict):
            return Response({"detail": "unit_prices must be {line: price}."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                services.update_purchase_order_costs(
                    po, logistics_cost=request.data.get("logistics_cost"), unit_prices=unit_prices
                )
                if receipts:
                    services.receive_purchase_order(po, receipts, actor_user_id=request.user_id)
        except services.PurchaseOrderError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self.get_queryset().get(id=po.id)).data)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """The PO as a PDF (the PO popup's Download PO): FynkTech's name,
        the store, every detail, products and costs - see wms/po_pdf.py."""
        from django.http import HttpResponse

        from integrations.barqraftar.loadsheet import render_pdf

        from .po_pdf import po_html

        po = self.get_object()
        data = self.get_serializer(po).data
        try:
            pdf_bytes = render_pdf(po_html(data, po.organization.name), context="purchase order")
        except Exception as exc:  # noqa: BLE001 - the worker's own message is the useful part
            return Response({"detail": str(exc).replace("BarqRaftar ", "")}, status=status.HTTP_502_BAD_GATEWAY)
        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{po.po_number}.pdf"'
        return response

    @action(detail=False, methods=["get"])
    def export(self, request):
        """Export (Purchase Orders page): every PO on the page's filters,
        one row per product, with all its details. ?id= - just that one PO
        (the PO popup's Download)."""
        import csv

        from django.http import HttpResponse

        from zoneinfo import ZoneInfo

        pkt = ZoneInfo("Asia/Karachi")
        response = HttpResponse(content_type="text/csv")
        queryset = self.get_queryset()
        one = (request.query_params.get("id") or "").strip()
        if one:
            queryset = queryset.filter(id=one)
            po = queryset.first()
            if po is None:
                return Response({"detail": "Purchase order not found."}, status=status.HTTP_404_NOT_FOUND)
            filename = f"{po.po_number}.csv"
        else:
            filename = "purchase_orders.csv"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow([
            "PO Number", "Order Date", "Supplier", "Supplier Phone", "Supplier City",
            "Warehouse Code", "Warehouse", "Status", "Note",
            "SKU", "Product Name", "Qty Ordered", "Product Cost", "Line Total",
            "Good Received", "Damaged Received", "Total Received", "Left to Receive",
            "PO Products Cost", "PO Logistics Cost", "PO Total Cost",
        ])
        for po in queryset.order_by("-number"):
            lines = list(po.lines.all())
            products_cost = sum(line.unit_price * line.quantity_ordered for line in lines)
            total_qty = sum(line.quantity_ordered for line in lines)
            received_qty = sum(line.good_received + line.damaged_received for line in lines)
            state = {"received": "Received", "partial": "Partially Received"}.get(
                services.purchase_order_state(total_qty, received_qty), "Not Received"
            )
            head = [
                po.po_number,
                po.ordered_at.astimezone(pkt).strftime("%Y-%m-%d %H:%M") if po.ordered_at else "",
                po.supplier.name, po.supplier.phone, po.supplier.city,
                po.warehouse.code, po.warehouse.name, state, po.note,
            ]
            tail = [str(products_cost), str(po.logistics_cost), str(products_cost + po.logistics_cost)]
            for line in lines or [None]:
                if line is None:
                    writer.writerow(head + [""] * 9 + tail)
                    continue
                received = line.good_received + line.damaged_received
                writer.writerow(head + [
                    line.sku, line.product_name, line.quantity_ordered, str(line.unit_price),
                    str(line.unit_price * line.quantity_ordered),
                    line.good_received, line.damaged_received, received,
                    max(line.quantity_ordered - received, 0),
                ] + tail)
        return response

    @action(detail=False, methods=["get"])
    def product(self, request):
        """Add PO's autofill: the stock item with exactly this SKU (name and
        Shopify image), or 404."""
        sku = (request.query_params.get("sku") or "").strip()
        item = (
            StockItem.objects.filter(organization_id=_stock_org(request), sku__iexact=sku)
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

        from integrations.services import sync_organization_inventory_from_shopify

        try:
            result = sync_organization_inventory_from_shopify(request.organization_id, images=True)
        except InventorySyncError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # noqa: BLE001 - surface Shopify API failures to the user, not a 500
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(result)


class StockItemViewSet(viewsets.ModelViewSet):
    serializer_class = StockItemSerializer
    permission_classes = [RequireAnyModule]
    # IMS (Inventory / Purchase Orders); "wms" too, for staff from before IMS.
    required_any_module = ("ims", "wms")
    page_access = {"*": {"read": ("ims.inventory", "ims.purchase_orders", "wms.packing", "wms.returns_desk", "reports"),
                         "write": ("ims.inventory",)}}
    pagination_class = WmsPagination

    def get_queryset(self):
        qs = StockItem.objects.filter(
            organization_id=_stock_org(self.request)
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
        serializer.save(organization_id=_stock_org(self.request))

    def _scoped_movements(self, request):
        movements = StockMovement.objects.filter(organization_id=_stock_org(request))
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

        qs = StockItem.objects.filter(organization_id=_stock_org(request))

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
            request.organization_id, search=params.get("search") or "", activity=params.get("activity") or "",
            # The Inventory tab (with) / the No SKUs tab (missing).
            sku_filter=params.get("sku") or "",
        )
        try:
            page_size = min(max(int(params.get("page_size") or 25), 1), 500)
            page = max(int(params.get("page") or 1), 1)
        except ValueError:
            page_size, page = 25, 1
        start = (page - 1) * page_size
        return Response({"count": len(rows), "results": rows[start : start + page_size], "summary": summary})

    @action(detail=False, methods=["get"], url_path="export")
    def export_inventory(self, request):
        """The Inventory table as a CSV, with the page's search / card
        filter (wms.inventory_io)."""
        from . import inventory_io

        params = request.query_params

        class Echo:
            def write(self, value):
                return value

        writer = csv.writer(Echo())
        rows = inventory_io.export_rows(
            request.organization_id, search=params.get("search") or "", activity=params.get("activity") or "",
            sku_filter=params.get("sku") or "",
        )
        response = StreamingHttpResponse((writer.writerow(r) for r in rows), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="inventory.csv"'
        return response

    @action(detail=False, methods=["post"], url_path="import", parser_classes=[MultiPartParser, FormParser])
    def import_inventory(self, request):
        """Sets each row's stock to its Available (wms.inventory_io) - a dry
        run unless apply=true."""
        from . import inventory_io

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Attach a CSV file as 'file'"}, status=status.HTTP_400_BAD_REQUEST)
        apply = str(request.data.get("apply", "")).lower() in ("1", "true", "yes")
        result = inventory_io.run_import(
            request.organization_id, upload, apply=apply, actor_user_id=request.user_id
        )
        if result.get("error"):
            return Response({"detail": result["error"]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

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
                ("Order placed (PO, not received)", "order_placed"),
                ("Total inbound (PO good)", "total_inbound"),
                ("Available stock", "available"),
                ("Reserved for dispatch (booked, not picked up)", "reserved"),
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

        from integrations.services import sync_organization_inventory_from_shopify

        try:
            result = sync_organization_inventory_from_shopify(request.organization_id)
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
    permission_classes = [RequireAnyModule]
    # IMS (Inventory / Purchase Orders); "wms" too, for staff from before IMS.
    required_any_module = ("ims", "wms")
    page_access = {"*": {"read": ("ims.inventory", "reports")}}
    pagination_class = WmsPagination

    def get_queryset(self):
        qs = StockMovement.objects.filter(
            organization_id=_stock_org(self.request)
        ).select_related("stock_item")
        sku = self.request.query_params.get("sku")
        if sku:
            qs = qs.filter(stock_item__sku=sku)
        order_number = self.request.query_params.get("order_number")
        if order_number:
            qs = qs.filter(order_number=order_number)
        return qs


def _returnable(order):
    """A parcel the returns desk can receive: Returned, or still Return in
    Transit (user, 2026-11-26 - it can reach the warehouse before the
    courier marks it returned), not yet received."""
    return oms_services.can_receive_return(order)


def _desk_bucket(params):
    """(received, scope) for the Returns Desk card on screen (`bucket`):
    "" Total = Return in Transit + Returned; "transit" = Return in Transit
    not received; "awaiting" = Returned not received; "received" = received
    (either). The older `received=yes/no` (Returned only) still works."""
    bucket = params.get("bucket")
    if bucket == "transit":
        return False, "transit"
    if bucket == "awaiting":
        return False, "returned"
    if bucket == "received":
        return True, "all"
    if bucket == "all":
        return None, "all"
    received = {"yes": True, "no": False}.get(params.get("received") or "")
    return received, "returned"


def _not_receivable(order):
    """Why the desk can't receive this order (it isn't a return), or ""."""
    if order.status == "returned" or oms_services.workflow_card(order) == "return_in_transit":
        return ""
    return f"Order is {oms_services.card_label(order)}, not Return in Transit or Returned"


def _packable(order):
    """An order the packing bench can pack."""
    return order.status == "ready_to_pick"


def _pick_one(hits, label, prefer=None):
    """(order_or_None, problem) out of every order matching one number.

    Order numbers are only unique within a store, so a Dispatch Hub / All
    Orders request (several stores) can match more than one - e.g. Fynktech's
    returned #3367 and One Stations' cancelled #3367 (2026-11-23). Taking
    whichever came first answered "Order is Cancelled, not Returned" for a
    parcel that was in fact returned, and could have received the wrong
    store's order. Now the one order the desk can act on (`prefer`) wins;
    when that's still not exactly one, nothing is guessed."""
    if len(hits) <= 1:
        return (hits[0] if hits else None), ""
    preferred = [order for order in hits if prefer(order)] if prefer else []
    if len(preferred) == 1:
        return preferred[0], ""
    return None, f"{label} is on orders in more than one store - scan its tracking number instead"


def _orders_by_number(org_kwargs, order_numbers, prefer=None):
    """One query for a whole batch - a bulk action over a page of selected
    rows shouldn't be a query per row. Used by the table's own bulk-select
    actions, which already know exactly which orders they mean - unlike a
    scan, there's no barcode to resolve. Returns {order_number: (order,
    problem)} - see _pick_one for a number found in several stores.

    `org_kwargs` is core.scoping.org_filter(request)'s dict - one store
    normally, every Dispatch Hub store when a super admin is operating
    several at once (safe here either way: every downstream service call
    below derives its own org from the Order row, never from request/
    ambient context, so an order from any matched store works unmodified).
    """
    hits = {}
    for order in Order.objects.filter(order_number__in=order_numbers, **org_kwargs):
        hits.setdefault(order.order_number, []).append(order)
    return {number: _pick_one(orders, number, prefer) for number, orders in hits.items()}


def _find_order(org_kwargs, request_data, prefer=None):
    """Resolves the order a scan/manual-entry or a table action refers to.

    The physical label on a parcel carries the courier's tracking number
    (that's literally what its barcode encodes), so the scan panel sends
    tracking_number. A table row's button knows its exact order and sends
    order_id (with order_number for display). order_number alone is the
    last resort, and may match one order per store (see _pick_one).

    Returns (order_or_None, raw_identifier, problem) - raw_identifier is
    whatever string was searched by, used only to label a not_found result
    (there's no order to pull a real order_number from in that case);
    problem is set when the code matched orders in several stores.
    """
    # A scanner's QR text ("CN,code,COD" on Leopards' slip) is cut down to
    # the code itself - see oms/scan_codes.py.
    from oms.scan_codes import scanned_code

    order_id = str(request_data.get("order_id") or "").strip()
    if order_id:
        label = scanned_code(request_data.get("order_number")) or order_id
        try:
            uuid.UUID(order_id)
        except ValueError:
            return None, label, ""
        return Order.objects.filter(id=order_id, **org_kwargs).first(), label, ""

    tracking_number = scanned_code(request_data.get("tracking_number"))
    if tracking_number:
        hits = list(Order.objects.filter(tracking_number=tracking_number, **org_kwargs)[:10])
        order, problem = _pick_one(hits, tracking_number, prefer)
        return order, tracking_number, problem

    order_number = scanned_code(request_data.get("order_number"))
    hits = list(Order.objects.filter(order_number=order_number, **org_kwargs)[:10])
    order, problem = _pick_one(hits, order_number, prefer)
    return order, order_number, problem


def _ambiguous(raw_identifier, problem):
    return {"success": False, "reason": problem, "order_number": raw_identifier}


def _with_items(*orders):
    """Loads the orders' items once, up front - the returns desk reads them
    twice per order (services.return_line_summary), a query each otherwise."""
    found = [order for order in orders if order is not None]
    if found:
        prefetch_related_objects(found, "items")


def _lookup_return(order, raw_identifier):
    """Read-only validation - the scan panel's first phase. Finds out
    whether a parcel is receivable at all, without recording anything, so
    the operator can be prompted for its condition (good/bad) before
    anything is written."""
    if order is None:
        return {"success": False, "reason": "not_found", "order_number": raw_identifier}
    problem = _not_receivable(order)
    if problem:
        return {"success": False, "reason": problem, "order_number": order.order_number}
    if order.return_received_at:
        return {"success": False, "reason": "Already received", "order_number": order.order_number}
    return {
        "success": True,
        # Return in Transit / Returned - the desk says which.
        "card": oms_services.card_label(order),
        # The receive that follows names this exact order - an order
        # number alone can be on orders in several stores (_pick_one).
        "order_id": str(order.id),
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
    problem = _not_receivable(order)
    if problem:
        return {"success": False, "reason": problem, "order_number": order.order_number}

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
    page_access = {"*": {"read": ("wms.returns_desk",), "write": ("wms.returns_desk",)}}

    def _csv_response(self, rows, filename):
        class Echo:
            def write(self, value):
                return value

        writer = csv.writer(Echo())
        response = StreamingHttpResponse((writer.writerow(r) for r in rows), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        """The desk's orders as a list - the card on screen (received=yes /
        no / blank for all), its dates and search (see returns_io)."""
        from zoneinfo import ZoneInfo

        from . import returns_io

        pkt = ZoneInfo("Asia/Karachi")
        received, scope = _desk_bucket(request.query_params)
        qs = returns_io.returned_orders(org_filter(request), request.query_params, received=received, scope=scope)
        when = lambda v: v.astimezone(pkt).strftime("%d/%m/%Y %I:%M %p") if v else ""
        return self._csv_response(returns_io.export_rows(qs, when), "returns.csv")

    @action(detail=False, methods=["get"], url_path="import-sheet")
    def import_sheet(self, request):
        """The Import file to fill in: one row per line of every order still
        Awaiting Scan (with the page's dates / search), Good = full qty."""
        from . import returns_io

        # The card on screen: Return in Transit's parcels, else Awaiting Scan's
        # (Returned, not received) as before.
        scope = "transit" if request.query_params.get("bucket") == "transit" else "returned"
        qs = returns_io.returned_orders(org_filter(request), request.query_params, received=False, scope=scope)
        return self._csv_response(returns_io.import_sheet_rows(qs), "returns_import.csv")

    @action(detail=False, methods=["post"], url_path="import", parser_classes=[MultiPartParser, FormParser])
    def import_counts(self, request):
        """Receives many returned parcels from a file of SKU-wise Good /
        Damaged / Lost counts - exactly what a scan does, per order. A dry
        run unless apply=true."""
        from . import returns_io

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Attach a CSV file as 'file'"}, status=status.HTTP_400_BAD_REQUEST)
        apply = str(request.data.get("apply", "")).lower() in ("1", "true", "yes")
        try:
            result = returns_io.run_import(
                org_filter(request), upload, apply=apply,
                actor_user_id=request.user_id, actor_email=getattr(request, "auth_email", "") or "",
            )
        except UnicodeDecodeError:
            return Response({"detail": "Could not read the file - please upload a UTF-8 CSV."},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=["post"], url_path="lookup")
    def lookup(self, request):
        """Read-only - the scan panel's first phase. Confirms a parcel is
        receivable (green tick) before the operator is asked whether it
        arrived in good or bad condition; nothing is written here."""
        if not (request.data.get("tracking_number") or request.data.get("order_number")
                or request.data.get("order_id")):
            return Response(
                {"detail": "tracking_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )
        order, raw_identifier, problem = _find_order(org_filter(request), request.data, prefer=_returnable)
        if problem:
            return Response(_ambiguous(raw_identifier, problem))
        if order is not None and _returnable(order):
            _with_items(order)  # only a receivable parcel's lines are read
        return Response(_lookup_return(order, raw_identifier))

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        """Receives one parcel. `breakdown` is the popup's count per line -
        [{key, good, damaged, lost}] - and only good units are restocked.
        Without it, `condition` ("good"/"bad") applies to every unit."""
        condition = (request.data.get("condition") or "good").strip()
        raw_breakdown = request.data.get("breakdown")
        if not (request.data.get("tracking_number") or request.data.get("order_number")
                or request.data.get("order_id")):
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

        order, raw_identifier, problem = _find_order(org_filter(request), request.data, prefer=_returnable)
        if problem:
            return Response(_ambiguous(raw_identifier, problem))
        if order is not None and _returnable(order):
            _with_items(order)
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

        found = _orders_by_number(org_filter(request), order_numbers, prefer=_returnable)
        _with_items(*(order for order, _ in found.values() if order is not None and _returnable(order)))
        note = (request.data.get("note") or "")[:255]
        actor_email = getattr(request, "auth_email", "") or ""
        results = []
        for number in order_numbers:
            order, problem = found.get(number, (None, ""))
            if problem:
                results.append(_ambiguous(number, problem))
                continue
            results.append(
                _receive_return(
                    order,
                    number,
                    condition=condition,
                    actor_user_id=request.user_id,
                    actor_email=actor_email,
                    note=note,
                )
            )
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
    page_access = {"*": {"read": ("wms.packing",), "write": ("wms.packing",)}}

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request):
        if not (request.data.get("tracking_number") or request.data.get("order_number")
                or request.data.get("order_id")):
            return Response(
                {"detail": "tracking_number is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        order, raw_identifier, problem = _find_order(org_filter(request), request.data, prefer=_packable)
        if problem:
            return Response(_ambiguous(raw_identifier, problem))
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

        found = _orders_by_number(org_filter(request), order_numbers, prefer=_packable)
        actor_email = getattr(request, "auth_email", "") or ""
        results = []
        for number in order_numbers:
            order, problem = found.get(number, (None, ""))
            if problem:
                results.append(_ambiguous(number, problem))
                continue
            results.append(
                _pack_order(order, number, actor_user_id=request.user_id, actor_email=actor_email)
            )
        return Response({"results": results})
