from django.urls import path

from . import admin_views, views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("health/protected/", views.health_protected, name="health-protected"),
    path("admin/organizations/", admin_views.organizations, name="admin-organizations"),
    path(
        "admin/organizations/<uuid:organization_id>/",
        admin_views.organization_detail,
        name="admin-organization-detail",
    ),
    path(
        "admin/users/<uuid:user_id>/",
        admin_views.update_member,
        name="admin-update-member",
    ),
]
