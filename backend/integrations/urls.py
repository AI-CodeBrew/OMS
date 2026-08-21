from django.urls import path

from . import views

urlpatterns = [
    path("shopify/", views.ShopifyConnectionView.as_view(), name="shopify-connection"),
    path("shopify/sync/", views.ShopifySyncView.as_view(), name="shopify-sync"),
    path("webhooks/shopify/orders/", views.shopify_order_webhook, name="shopify-order-webhook"),
]
