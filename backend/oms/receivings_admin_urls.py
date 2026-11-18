"""Included from core/urls.py under admin/receivings/ - see receivings_admin."""

from django.urls import path

from . import receivings_admin

urlpatterns = [
    path("", receivings_admin.receivings, name="admin-receivings"),
    path("images/<uuid:image_id>/", receivings_admin.receiving_image, name="admin-receiving-image"),
    path("<uuid:receiving_id>/", receivings_admin.receiving_detail, name="admin-receiving-detail"),
]
