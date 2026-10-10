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

from django.db import IntegrityError, transaction
from django.utils.text import slugify

from .models import Organization

logger = logging.getLogger(__name__)

PLATFORM_NAME = "OMS Courier"
PLATFORM_SLUG = "fynktech-oms-courier"


def get_platform_organization():
    org = Organization.objects.filter(is_platform=True).first()
    if org is not None:
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
    return org
