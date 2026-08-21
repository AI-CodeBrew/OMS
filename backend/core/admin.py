from django.contrib import admin

from .models import Membership, Organization, OrganizationModule


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "plan", "is_active", "created_at")
    search_fields = ("name", "slug")


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("organization", "user_id", "role", "created_at")
    list_filter = ("role",)


@admin.register(OrganizationModule)
class OrganizationModuleAdmin(admin.ModelAdmin):
    list_display = ("organization", "module", "is_enabled")
    list_filter = ("module", "is_enabled")
