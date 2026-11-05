"""Included from core/urls.py under admin/inventory/ - see inventory_admin_views."""

from django.urls import path

from . import inventory_admin_views

urlpatterns = [
    path("", inventory_admin_views.inventory, name="admin-inventory"),
    path("<uuid:item_id>/report/", inventory_admin_views.inventory_report, name="admin-inventory-report"),
]
