from django.urls import path

from . import views

urlpatterns = [
    path("", views.PostExConnectionView.as_view(), name="postex-connection"),
    path("status/", views.PostExStatusView.as_view(), name="postex-status"),
    path("sync/", views.PostExSyncView.as_view(), name="postex-sync"),
    path("cities/", views.PostExCityListView.as_view(), name="postex-cities"),
    path("pickup-addresses/", views.PostExPickupAddressesView.as_view(), name="postex-pickup-addresses"),
    path("shipments/", views.PostExShipmentsView.as_view(), name="postex-shipments"),
    path("shipments/track/", views.PostExShipmentTrackView.as_view(), name="postex-shipment-track"),
    path("shipments/action/", views.PostExShipmentActionView.as_view(), name="postex-shipment-action"),
    path("airway-bills/", views.PostExAirwayBillView.as_view(), name="postex-airway-bills"),
    path("loadsheet/", views.PostExLoadSheetView.as_view(), name="postex-loadsheet"),
]
