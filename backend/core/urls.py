from django.urls import path

from . import admin_views, team_views, views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("health/protected/", views.health_protected, name="health-protected"),
    path("team/", team_views.team_members, name="team-members"),
    path("team/<uuid:user_id>/", team_views.team_member_detail, name="team-member-detail"),
    path("audit-logs/", team_views.audit_logs, name="audit-logs"),
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
