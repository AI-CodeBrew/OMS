from django.urls import path

from . import views

urlpatterns = [
    path("", views.BarqRaftarConnectionView.as_view(), name="barqraftar-connection"),
    path("status/", views.BarqRaftarStatusView.as_view(), name="barqraftar-status"),
    path("sync/", views.BarqRaftarSyncView.as_view(), name="barqraftar-sync"),
    path("cities/", views.BarqRaftarCityListView.as_view(), name="barqraftar-cities"),
    path("pickup-addresses/", views.BarqRaftarPickupAddressesView.as_view(), name="barqraftar-pickup-addresses"),
    path("shipments/", views.BarqRaftarShipmentsView.as_view(), name="barqraftar-shipments"),
    path("shipments/track/", views.BarqRaftarShipmentTrackView.as_view(), name="barqraftar-shipment-track"),
    path("shipments/action/", views.BarqRaftarShipmentActionView.as_view(), name="barqraftar-shipment-action"),
    path("labels/", views.BarqRaftarLabelsView.as_view(), name="barqraftar-labels"),
    path("payments/", views.BarqRaftarPaymentsView.as_view(), name="barqraftar-payments"),
    path(
        "payments/<str:payment_id>/",
        views.BarqRaftarPaymentDetailView.as_view(),
        name="barqraftar-payment-detail",
    ),
    path(
        "webhook/<uuid:token>/",
        views.barqraftar_webhook,
        name="barqraftar-webhook",
    ),
    # Same slashless duplicate Smartlane's webhook route has - Django's
    # APPEND_SLASH answers a slashless POST with a 301, which arrives back
    # as a bodyless GET, so a webhook URL pasted without the final "/"
    # would silently deliver nothing.
    path(
        "webhook/<uuid:token>",
        views.barqraftar_webhook,
    ),
]
