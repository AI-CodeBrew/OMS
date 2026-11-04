"""FynkTech's own courier accounts - the super admin's "OMS Courier" tab.

Some stores hand their dispatching to FynkTech, which books their orders
through FynkTech's own BarqRaftar / PostEx / Smartlane accounts. Those
accounts live on one hidden organization (Organization.is_platform) rather
than in a parallel set of platform-only tables: the connection models are
all tenant-scoped, so a real org lets them be stored, polled and managed
exactly like a store's - the super admin acts as this org (X-Act-As-
Organization) on the same integration screens a store admin uses.

The org is created on first use and never listed anywhere a store is
(organization_admin_service, the Dispatch Hub, the Integrations overview).
"""

import logging
import re
import uuid

from django.db import IntegrityError, transaction
from django.utils.text import slugify

from .models import Organization

logger = logging.getLogger(__name__)

PLATFORM_NAME = "OMS Courier"
PLATFORM_SLUG = "fynktech-oms-courier"


_platform_id = None


def platform_organization_id():
    """The platform org's id, or None until it exists (it's created the first
    time the OMS Couriers tab opens). Cached once found - it never changes,
    and the pollers and webhooks ask on every shipment."""
    global _platform_id
    if _platform_id is None:
        _platform_id = (
            Organization.objects.filter(is_platform=True).values_list("id", flat=True).first()
        )
    return _platform_id


def is_platform_organization(organization_id):
    platform_id = platform_organization_id()
    return platform_id is not None and str(platform_id) == str(organization_id)


def store_reference_code(organization_id):
    """Six characters that identify a store inside FynkTech's own Smartlane
    account: the first three letters of its slug, then the first three hex
    digits of its id ("ACM3FA"). Needed because every Shopify store starts
    at #1001 and Smartlane reports a consignment by store_order_id alone (a
    booking returns no consignment number). Fixed length, so a code followed
    by an order number can never equal another store's code + number.

    PostEx, BarqRaftar and Leopards don't use this: they accept the same
    order number from several stores and return a tracking number per
    booking, which is what identifies the parcel from then on."""
    slug = Organization.objects.filter(id=organization_id).values_list("slug", flat=True).first()
    letters = re.sub(r"[^A-Za-z]", "", slug or "").upper()[:3].ljust(3, "X")
    return f"{letters}{uuid.UUID(str(organization_id)).hex[:3].upper()}"


def platform_smartlane_reference(order):
    """Smartlane's store_order_id for a Dispatch Hub booking - letters and
    digits only (Smartlane takes alphanumeric ids, nothing more is known to
    be safe), so the store code runs straight into the order number."""
    digits = re.sub(r"[^A-Za-z0-9]", "", order.order_number)
    return f"{store_reference_code(order.organization_id)}{digits}"


def get_platform_organization():
    global _platform_id
    org = Organization.objects.filter(is_platform=True).first()
    if org is not None:
        _platform_id = org.id
        return org

    slug = PLATFORM_SLUG
    suffix = 2
    while Organization.objects.filter(slug=slug).exists():
        slug = slugify(f"{PLATFORM_SLUG}-{suffix}")
        suffix += 1
    try:
        with transaction.atomic():
            org = Organization.objects.create(
                name=PLATFORM_NAME, slug=slug, plan="enterprise", is_platform=True
            )
    except IntegrityError:
        # Another request created it first - core_one_platform_organization
        # guarantees there's only ever one.
        return Organization.objects.get(is_platform=True)
    logger.info("created the OMS Courier platform organization %s", org.id)
    _platform_id = org.id
    return org
