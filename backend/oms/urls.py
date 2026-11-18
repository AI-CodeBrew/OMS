from django.urls import path
from rest_framework.routers import DefaultRouter

from . import export_api

from .views import (
    CityNamesView,
    CourierViewSet,
    DailyReadyToPrintView,
    DispatchBatchViewSet,
    OrderViewSet,
    PrintBatchViewSet,
    ReportView,
    TicketViewSet,
)

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
router.register("couriers", CourierViewSet, basename="courier")
router.register("print-batches", PrintBatchViewSet, basename="print-batch")
router.register("dispatch-batches", DispatchBatchViewSet, basename="dispatch-batch")
router.register("tickets", TicketViewSet, basename="ticket")

urlpatterns = router.urls + [
    path("cities/", CityNamesView.as_view(), name="city-names"),
    path("report/", ReportView.as_view(), name="report"),
    path("daily-batches/", DailyReadyToPrintView.as_view(), name="daily-batches"),
    # Read-only live data API (API key) - oms/export_api.py.
    path("export/orders-report/", export_api.orders_report, name="export-orders-report"),
]
