from django.core.management.base import BaseCommand
from django.db import connection

from core.models import Organization, OrganizationModule


class Command(BaseCommand):
    help = (
        "One-off migration: copies rows from the legacy public.orders / "
        "public.order_items tables (tenant_id-based, predating this Django "
        "rebuild - they were created directly in Supabase, not by any code "
        "in this repo) into the new oms.orders / oms.order_items tables "
        "(organization_id-based). Creates a matching core.Organization for "
        "each legacy public.tenants row, reusing the same id so no separate "
        "mapping table is needed, and enables the oms module for it. "
        "Safe to re-run - inserts are ON CONFLICT (id) DO NOTHING."
    )

    def handle(self, *args, **options):
        with connection.cursor() as cur:
            cur.execute("SELECT id, name, slug, plan, is_active FROM public.tenants;")
            legacy_tenants = cur.fetchall()

        if not legacy_tenants:
            self.stdout.write(self.style.WARNING("No rows in public.tenants - nothing to migrate."))
            return

        valid_plans = dict(Organization.PLAN_CHOICES)

        for tenant_id, name, slug, plan, is_active in legacy_tenants:
            organization, created = Organization.objects.get_or_create(
                id=tenant_id,
                defaults={
                    "name": name,
                    "slug": slug,
                    "plan": plan if plan in valid_plans else "starter",
                    "is_active": is_active,
                },
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"{'Created' if created else 'Using existing'} organization "
                    f"{organization.name} ({organization.id}) from legacy tenant {slug!r}"
                )
            )

            OrganizationModule.objects.update_or_create(
                organization=organization, module="oms", defaults={"is_enabled": True}
            )

            with connection.cursor() as cur:
                cur.execute(
                    """
                    insert into oms.orders
                        (id, organization_id, order_number, customer_name,
                         customer_phone, status, total_amount, created_at, updated_at)
                    select
                        o.id, %s, o.order_number, coalesce(o.customer_name, ''),
                        coalesce(o.customer_phone, ''), coalesce(o.status, 'pending'),
                        coalesce(o.total_price, 0), o.created_at,
                        coalesce(o.updated_at, o.created_at)
                    from public.orders o
                    where o.tenant_id = %s
                    on conflict (id) do nothing;
                    """,
                    [str(organization.id), str(tenant_id)],
                )
                orders_inserted = cur.rowcount

                cur.execute(
                    """
                    insert into oms.order_items
                        (id, organization_id, order_id, product_name,
                         quantity, unit_price, created_at, updated_at)
                    select
                        oi.id, %s, oi.order_id, coalesce(oi.title, oi.sku, ''),
                        coalesce(oi.quantity, 1), coalesce(oi.price, 0),
                        oi.created_at, oi.created_at
                    from public.order_items oi
                    where oi.tenant_id = %s
                    on conflict (id) do nothing;
                    """,
                    [str(organization.id), str(tenant_id)],
                )
                items_inserted = cur.rowcount

            self.stdout.write(
                self.style.SUCCESS(
                    f"  -> inserted {orders_inserted} orders, {items_inserted} order_items"
                )
            )
