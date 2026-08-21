import uuid

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from core.models import Membership, Organization, OrganizationModule


class Command(BaseCommand):
    help = (
        "Create an Organization, link an existing Supabase Auth user to it "
        "as org_admin, and set that user's JWT claims (organization_id, "
        "organization_name, role) via the Supabase Admin API so their next "
        "login carries the new claims."
    )

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="Organization display name")
        parser.add_argument(
            "--user-id", required=True, help="Supabase auth.users.id (uuid) of the admin user"
        )
        parser.add_argument("--slug", help="URL-safe slug (derived from name if omitted)")
        parser.add_argument("--plan", default="starter")
        parser.add_argument(
            "--modules",
            default="oms",
            help="Comma-separated modules to enable, e.g. oms,wms,finance",
        )

    def handle(self, *args, **options):
        name = options["name"]
        slug = options.get("slug") or slugify(name)
        user_id = options["user_id"]
        plan = options["plan"]
        modules = [m.strip() for m in options["modules"].split(",") if m.strip()]

        try:
            uuid.UUID(user_id)
        except ValueError as exc:
            raise CommandError("--user-id must be a valid UUID") from exc

        organization, created = Organization.objects.get_or_create(
            slug=slug, defaults={"name": name, "plan": plan}
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Created' if created else 'Found existing'} organization "
                f"{organization.name} ({organization.id})"
            )
        )

        Membership.objects.update_or_create(
            organization=organization,
            user_id=user_id,
            defaults={"role": "org_admin"},
        )
        self.stdout.write(self.style.SUCCESS(f"Linked user {user_id} as org_admin"))

        for module in modules:
            OrganizationModule.objects.update_or_create(
                organization=organization,
                module=module,
                defaults={"is_enabled": True},
            )
        self.stdout.write(self.style.SUCCESS(f"Enabled modules: {', '.join(modules)}"))

        self._set_supabase_claims(user_id, organization, role="org_admin")
        self.stdout.write(self.style.SUCCESS("Updated Supabase Auth app_metadata"))

    def _set_supabase_claims(self, user_id, organization, role):
        url = f"{settings.SUPABASE_URL}/auth/v1/admin/users/{user_id}"
        headers = {
            "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "app_metadata": {
                "organization_id": str(organization.id),
                "organization_name": organization.name,
                "role": role,
            }
        }
        response = requests.put(url, json=payload, headers=headers, timeout=15)
        if not response.ok:
            raise CommandError(
                f"Supabase Admin API call failed ({response.status_code}): {response.text}"
            )
