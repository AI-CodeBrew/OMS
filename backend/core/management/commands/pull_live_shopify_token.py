"""
Copy a Shopify store's current access token from the live database into
the local (testing) one, for local testing against a store whose token
the live connector keeps refreshing.

Shopify app tokens expire after an hour and only the live connector
refreshes them, so rerun this whenever local Shopify calls start failing
with 401. Live is only ever read - this never refreshes a token itself,
since refreshing rotates the refresh token and would break the live
connection.

    python manage.py pull_live_shopify_token riphahcollection.myshopify.com --org "Fynktech Test"
"""
from pathlib import Path

import psycopg
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection as local_db
from dotenv import dotenv_values

from core.models import Organization
from integrations.models import ShopifyConnection

LIVE_ENV_FILE = Path(settings.BASE_DIR) / ".env.backend.live"


class Command(BaseCommand):
    help = "Copy a store's current Shopify access token from the live database into the local one"

    def add_arguments(self, parser):
        parser.add_argument("shop_domain", help="e.g. riphahcollection.myshopify.com")
        parser.add_argument("--org", required=True, help="Local organization name to attach the store to")

    def handle(self, *args, **options):
        shop_domain = options["shop_domain"].strip().lower()
        if not shop_domain.endswith(".myshopify.com"):
            shop_domain += ".myshopify.com"

        live_url = dotenv_values(LIVE_ENV_FILE).get("DATABASE_URL")
        if not live_url:
            raise CommandError(f"DATABASE_URL missing from {LIVE_ENV_FILE}")
        live_host = dotenv_values(LIVE_ENV_FILE).get("SUPABASE_URL", "")
        if live_host and live_host == settings.SUPABASE_URL:
            raise CommandError("This backend is pointed at the live project - switch to the testing profile first")

        with psycopg.connect(live_url, autocommit=True) as live:
            live.execute("set default_transaction_read_only = on")
            row = live.execute(
                """select shop_name, currency, access_token, webhook_secret
                   from integrations.shopify_connections where shop_domain = %s""",
                (shop_domain,),
            ).fetchone()
        if not row:
            raise CommandError(f"{shop_domain} is not connected on live")
        shop_name, currency, access_token, webhook_secret = row

        try:
            organization = Organization.objects.get(name=options["org"])
        except Organization.DoesNotExist as exc:
            raise CommandError(f"No local organization named {options['org']!r}") from exc

        # One store per organization - drop whatever else this org was using.
        ShopifyConnection.all_objects.filter(organization=organization).exclude(shop_domain=shop_domain).delete()
        _, created = ShopifyConnection.all_objects.update_or_create(
            shop_domain=shop_domain,
            defaults={
                "organization": organization,
                "shop_name": shop_name,
                "currency": currency,
                "access_token": access_token,
                "webhook_secret": webhook_secret,
                "is_connected": True,
            },
        )
        self.stdout.write(self.style.SUCCESS(
            f"{'Connected' if created else 'Refreshed token for'} {shop_domain} "
            f"-> {organization.name} ({local_db.settings_dict['HOST']})"
        ))
