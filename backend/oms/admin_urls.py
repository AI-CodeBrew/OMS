"""Included from core/urls.py under the admin/tickets/ prefix so these
inherit AdminIPAllowlistMiddleware's /api/core/admin/ gate. See admin_views."""

from django.urls import path

from . import admin_views

urlpatterns = [
    path("", admin_views.tickets, name="admin-tickets"),
    path("store-orders/", admin_views.ticket_store_orders, name="admin-ticket-store-orders"),
    path("<uuid:ticket_id>/", admin_views.ticket_detail, name="admin-ticket-detail"),
    path("<uuid:ticket_id>/resolve/", admin_views.ticket_resolve, name="admin-ticket-resolve"),
    path("<uuid:ticket_id>/status/", admin_views.ticket_status, name="admin-ticket-status"),
    path("<uuid:ticket_id>/messages/", admin_views.ticket_messages, name="admin-ticket-messages"),
]
