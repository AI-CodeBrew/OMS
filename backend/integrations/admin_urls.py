"""Included from core/urls.py under the admin/smartlane/ prefix so these
inherit AdminIPAllowlistMiddleware's /api/core/admin/ gate. See admin_views."""

from django.urls import path

from . import admin_views

urlpatterns = [
    path("config/", admin_views.business_config, name="admin-smartlane-config"),
    path("config/test/", admin_views.business_config_test, name="admin-smartlane-config-test"),
    path("couriers/", admin_views.courier_offerings, name="admin-smartlane-couriers"),
    path(
        "couriers/<int:offering_id>/",
        admin_views.courier_offering_detail,
        name="admin-smartlane-courier-detail",
    ),
    path("stores/", admin_views.store_links, name="admin-smartlane-stores"),
    path("stores/sync/", admin_views.store_links_sync, name="admin-smartlane-stores-sync"),
    path(
        "stores/<uuid:link_id>/approve/",
        admin_views.store_link_approve,
        name="admin-smartlane-store-approve",
    ),
    path(
        "stores/<uuid:link_id>/reject/",
        admin_views.store_link_reject,
        name="admin-smartlane-store-reject",
    ),
    path(
        "stores/<uuid:link_id>/warehouses/",
        admin_views.store_link_warehouses,
        name="admin-smartlane-store-warehouses",
    ),
    path(
        "stores/<uuid:link_id>/warehouses/provision/",
        admin_views.store_link_warehouses_provision,
        name="admin-smartlane-store-warehouses-provision",
    ),
]
