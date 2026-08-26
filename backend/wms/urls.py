from rest_framework.routers import DefaultRouter

from .views import ReturnRestockView, StockItemViewSet, StockMovementViewSet, WarehouseViewSet

router = DefaultRouter()
router.register("warehouses", WarehouseViewSet, basename="warehouse")
router.register("stock", StockItemViewSet, basename="stock-item")
router.register("movements", StockMovementViewSet, basename="stock-movement")
router.register("returns", ReturnRestockView, basename="return-restock")

urlpatterns = router.urls
