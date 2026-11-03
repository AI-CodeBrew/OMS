"""Included from core/urls.py under admin/cities/ - see city_admin_views."""

from django.urls import path

from . import city_admin_views

urlpatterns = [
    path("", city_admin_views.cities, name="admin-cities"),
    path("import/", city_admin_views.city_import, name="admin-cities-import"),
    path("<int:city_id>/", city_admin_views.city_detail, name="admin-city-detail"),
]
