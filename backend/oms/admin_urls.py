"""Included from core/urls.py under the admin/tickets/ prefix so these
inherit AdminIPAllowlistMiddleware's /api/core/admin/ gate. See admin_views."""

from django.urls import path

from . import admin_views

urlpatterns = [
    path("", admin_views.tickets, name="admin-tickets"),
    path("<uuid:ticket_id>/", admin_views.ticket_detail, name="admin-ticket-detail"),
    path("<uuid:ticket_id>/resolve/", admin_views.ticket_resolve, name="admin-ticket-resolve"),
    path("<uuid:ticket_id>/assign/", admin_views.ticket_assign, name="admin-ticket-assign"),
    path("<uuid:ticket_id>/priority/", admin_views.ticket_priority, name="admin-ticket-priority"),
    path("<uuid:ticket_id>/messages/", admin_views.ticket_messages, name="admin-ticket-messages"),
]
