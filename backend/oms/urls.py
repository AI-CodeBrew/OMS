from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CourierViewSet, OrderViewSet, PrintBatchViewSet, ReportView

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
router.register("couriers", CourierViewSet, basename="courier")
router.register("print-batches", PrintBatchViewSet, basename="print-batch")

urlpatterns = router.urls + [
    path("report/", ReportView.as_view(), name="report"),
]
