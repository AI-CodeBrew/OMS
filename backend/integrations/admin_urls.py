"""Included from core/urls.py under the admin/smartlane/ prefix so these
inherit AdminIPAllowlistMiddleware's /api/core/admin/ gate. See admin_views."""

from django.urls import path

from . import admin_views

urlpatterns = [
    path("config/", admin_views.business_config, name="admin-smartlane-config"),
    path("config/test/", admin_views.business_config_test, name="admin-smartlane-config-test"),
]
