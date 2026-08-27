"""
Create or update the platform super admin from SUPER_ADMIN_EMAIL /
SUPER_ADMIN_PASSWORD in backend/.env.backend.

Usage:
  python manage.py bootstrap_super_admin
"""

import os

from django.core.management.base import BaseCommand, CommandError

from core import supabase_admin
from core.supabase_admin import SupabaseAdminError


class Command(BaseCommand):
    help = "Bootstrap the super_admin user from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD"

    def handle(self, *args, **options):
        email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
        password = os.getenv("SUPER_ADMIN_PASSWORD") or ""

        if not email or not password:
            raise CommandError(
                "Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in backend/.env.backend first"
            )
        if len(password) < 8:
            raise CommandError("SUPER_ADMIN_PASSWORD must be at least 8 characters")

        try:
            user = supabase_admin.ensure_user(
                email=email,
                password=password,
                app_metadata={"role": "super_admin"},
            )
        except SupabaseAdminError as exc:
            raise CommandError(exc.message) from exc

        user_id = user.get("id")
        self.stdout.write(
            self.style.SUCCESS(
                f"Super admin ready: {email} (id={user_id}). "
                f"Sign in at /login → redirected to /admin."
            )
        )
