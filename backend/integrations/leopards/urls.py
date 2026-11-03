from django.urls import path

from . import views

urlpatterns = [
    path("", views.LeopardsConnectionView.as_view(), name="leopards-connection"),
    path("status/", views.LeopardsStatusView.as_view(), name="leopards-status"),
    path("sync/", views.LeopardsSyncView.as_view(), name="leopards-sync"),
    path("cities/", views.LeopardsCityListView.as_view(), name="leopards-cities"),
    path("shipments/", views.LeopardsShipmentsView.as_view(), name="leopards-shipments"),
    path("shipments/track/", views.LeopardsShipmentTrackView.as_view(), name="leopards-shipment-track"),
    path("shipments/action/", views.LeopardsShipmentActionView.as_view(), name="leopards-shipment-action"),
    path("airway-bills/", views.LeopardsAirwayBillView.as_view(), name="leopards-airway-bills"),
    path("loadsheet/", views.LeopardsLoadSheetView.as_view(), name="leopards-loadsheet"),
    path("webhook/<uuid:token>/", views.leopards_webhook, name="leopards-webhook"),
    # Slashless duplicate, same as PostEx's/BarqRaftar's/Smartlane's - Django's
    # APPEND_SLASH answers a slashless POST with a 301 that arrives back as
    # a bodyless GET, so a URL registered without the final "/" would
    # silently deliver nothing.
    path("webhook/<uuid:token>", views.leopards_webhook),
]
