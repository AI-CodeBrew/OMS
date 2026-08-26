from rest_framework.routers import DefaultRouter

from .views import CourierViewSet, OrderViewSet

router = DefaultRouter()
router.register("orders", OrderViewSet, basename="order")
router.register("couriers", CourierViewSet, basename="courier")

urlpatterns = router.urls
