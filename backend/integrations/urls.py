from django.urls import path

from . import views

urlpatterns = [
    path("shopify/", views.ShopifyConnectionView.as_view(), name="shopify-connection"),
    path("shopify/test/", views.ShopifyTestConnectionView.as_view(), name="shopify-test-connection"),
    path("shopify/sync/", views.ShopifySyncView.as_view(), name="shopify-sync"),
    path("shopify/gaps/", views.ShopifyGapView.as_view(), name="shopify-gaps"),
    path("webhooks/shopify/orders/", views.shopify_order_webhook, name="shopify-order-webhook"),
    path("webhooks/shopify/products/", views.shopify_product_webhook, name="shopify-product-webhook"),
    path("webhooks/shopify/inventory/", views.shopify_inventory_webhook, name="shopify-inventory-webhook"),
    path("smartlane/", views.SmartlaneConnectionView.as_view(), name="smartlane-connection"),
    path(
        "smartlane/webhook/<uuid:token>/",
        views.smartlane_shipment_webhook,
        name="smartlane-shipment-webhook",
    ),
    # Same view without the trailing slash. Django's APPEND_SLASH answers a
    # slashless POST with a 301, and a redirected POST arrives as a GET with
    # no body - so a URL pasted into Smartlane's webhook builder without the
    # final "/" would silently deliver nothing. Cheaper to accept both.
    path(
        "smartlane/webhook/<uuid:token>",
        views.smartlane_shipment_webhook,
    ),
    path("smartlane/sync/", views.SmartlaneSyncView.as_view(), name="smartlane-sync"),
    path("smartlane/warehouses/", views.SmartlaneWarehouseListView.as_view(), name="smartlane-warehouses"),
    path("smartlane/cities/", views.SmartlaneCityListView.as_view(), name="smartlane-cities"),
]
