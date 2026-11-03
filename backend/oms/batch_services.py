"""Filing generated load sheets / airway bills into dispatch batches.

Every print path - Smartlane (oms/views.py), PostEx and BarqRaftar
(integrations/*/views.py) - saves what it generated through
save_print_batch, so the Batch page's History has one card per set of
orders with every document printed for it."""

import logging

from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from .models import DispatchBatch, DispatchBatchOrder, Order, PrintBatch

logger = logging.getLogger(__name__)


# Explicit all_objects throughout: the reverse relations' default
# (TenantManager) returns nothing outside a request's tenant context, and
# every caller here has already scoped by organization_id itself.
_ALL_ENTRIES = Prefetch("entries", queryset=DispatchBatchOrder.all_objects.all())


def _active_numbers(batch):
    return sorted(e.order_number for e in batch.entries.all() if e.removed_at is None)


def _courier_fits(batch_courier, courier):
    # An empty courier on either side (a Smartlane airway bill names none)
    # matches anything.
    return not batch_courier or not courier or batch_courier == courier


def find_or_create_batch(*, organization_id, courier, order_numbers, actor_user_id):
    """The batch whose current orders are exactly `order_numbers` (the
    load sheet printed after that set's airway bill lands next to it), or
    a new one. No order numbers (a date-ranged Smartlane load sheet) has
    nothing to match on, so it always gets a batch of its own."""
    sorted_numbers = sorted({str(n) for n in order_numbers})
    if sorted_numbers:
        candidates = (
            DispatchBatch.all_objects.filter(
                organization_id=organization_id,
                entries__order_number=sorted_numbers[0],
                entries__removed_at__isnull=True,
            )
            .prefetch_related(_ALL_ENTRIES)
            .order_by("-created_at")
            .distinct()
        )
        for batch in candidates:
            if _courier_fits(batch.courier, courier) and _active_numbers(batch) == sorted_numbers:
                if courier and not batch.courier:
                    batch.courier = courier
                    batch.save(update_fields=["courier", "updated_at"])
                return batch

    batch = DispatchBatch.all_objects.create(
        organization_id=organization_id, courier=courier or "", created_by_user_id=actor_user_id,
    )
    order_ids = dict(
        Order.all_objects.filter(
            organization_id=organization_id, order_number__in=sorted_numbers
        ).values_list("order_number", "id")
    )
    DispatchBatchOrder.all_objects.bulk_create([
        DispatchBatchOrder(
            organization_id=organization_id, batch=batch,
            order_id=order_ids.get(number), order_number=number,
        )
        for number in sorted_numbers
    ])
    return batch


def save_print_batch(*, organization_id, kind, courier, order_numbers, content,
                     content_type="application/pdf", actor_user_id=None, filename=None):
    """Keeps a permanent copy of exactly what was generated, so the Batch
    page can offer it back later without re-hitting the courier - which
    could return different data by then, or fail outright if a consignment
    was since cancelled. Best-effort: a storage hiccup here must not block
    the document the user is actively downloading right now.

    Reprinting the same kind for the same batch (same orders and courier)
    replaces that document's file instead of piling up a duplicate."""
    try:
        sorted_numbers = sorted({str(n) for n in order_numbers})
        courier = courier or ""
        with transaction.atomic():
            batch = find_or_create_batch(
                organization_id=organization_id, courier=courier,
                order_numbers=sorted_numbers, actor_user_id=actor_user_id,
            )
            document = (
                PrintBatch.all_objects.filter(batch=batch, kind=kind, courier=courier).first()
                if sorted_numbers else None
            )
            old_name = ""
            if document:
                old_name = document.file.name or ""
                document.content_type = content_type
                document.created_by_user_id = actor_user_id
            else:
                document = PrintBatch.all_objects.create(
                    organization_id=organization_id, batch=batch, kind=kind, courier=courier,
                    order_count=len(sorted_numbers), order_numbers=sorted_numbers,
                    content_type=content_type, created_by_user_id=actor_user_id,
                )
            ext = "pdf" if content_type == "application/pdf" else "html"
            document.file.save(filename or f"{kind}.{ext}", ContentFile(content), save=True)
            if old_name and old_name != document.file.name:
                # FieldFile.save() doesn't delete the previous file on its
                # own - it would leak in storage forever, orphaned. Only
                # after the new one is safely uploaded; a same-day reprint
                # reuses the same path and was simply overwritten.
                document.file.storage.delete(old_name)
            # Bumps the card back to the top of History's "last activity".
            DispatchBatch.all_objects.filter(pk=batch.pk).update(updated_at=timezone.now())
        return document
    except Exception:
        logger.exception("failed to save print batch (%s, %s)", kind, courier)
        return None


def remove_orders(batch, order_numbers, *, actor_user_id):
    """Takes `order_numbers` out of `batch`. The orders and the documents
    already generated are untouched - the documents still list them, as
    printed. Returns how many were removed."""
    return DispatchBatchOrder.all_objects.filter(
        batch=batch, order_number__in=[str(n) for n in order_numbers], removed_at__isnull=True
    ).update(removed_at=timezone.now(), removed_by_user_id=actor_user_id, updated_at=timezone.now())
