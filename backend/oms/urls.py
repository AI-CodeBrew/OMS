from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CourierViewSet,
    DailyReadyToPrintView,
    OrderViewSet,
    PrintBatchViewSet,
    ReportView,
    TicketViewSet,
)

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
router.register("couriers", CourierViewSet, basename="courier")
router.register("print-batches", PrintBatchViewSet, basename="print-batch")
router.register("tickets", TicketViewSet, basename="ticket")

urlpatterns = router.urls + [
    path("report/", ReportView.as_view(), name="report"),
    path("daily-batches/", DailyReadyToPrintView.as_view(), name="daily-batches"),
]
