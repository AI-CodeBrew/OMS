"""Invoices FynkTech issues to a store for dispatching its orders.

A draft is generated from DispatchHubStore.per_order_rate x the store's
dispatched-order count for a period, then hand-edited (add/remove/change
lines) before being issued - only then does it get a number and become
visible to the store itself (see finance/views.py's tenant list, which
excludes drafts entirely)."""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from core.models import DispatchHubStore, Organization
from core.rbac import write_audit_log
from oms.models import Order

from .models import Invoice, InvoiceLine


class InvoiceError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _serialize_line(line):
    return {
        "id": str(line.id),
        "kind": line.kind,
        "description": line.description,
        "quantity": str(line.quantity),
        "unit_price": str(line.unit_price),
        "amount": str(line.amount),
    }


def serialize_invoice(invoice, *, include_org=False):
    data = {
        "id": str(invoice.id),
        "number": invoice.number,
        "status": invoice.status,
        "period_start": invoice.period_start.isoformat() if invoice.period_start else None,
        "period_end": invoice.period_end.isoformat() if invoice.period_end else None,
        "issued_at": invoice.issued_at.isoformat() if invoice.issued_at else None,
        "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
        "subtotal": str(invoice.subtotal),
        "total": str(invoice.total),
        "notes": invoice.notes,
        "created_at": invoice.created_at.isoformat(),
        "lines": [_serialize_line(line) for line in invoice.lines.all()],
    }
    if include_org:
        data["organization_id"] = str(invoice.organization_id)
        data["store_name"] = invoice.organization.name
    return data


def _recompute_totals(invoice):
    subtotal = sum((line.amount for line in invoice.lines.all()), Decimal("0"))
    invoice.subtotal = subtotal
    invoice.total = subtotal
    invoice.save(update_fields=["subtotal", "total", "updated_at"])


def list_invoices(*, organization_id=None, status=None):
    qs = Invoice.all_objects.select_related("organization").prefetch_related("lines")
    if organization_id:
        qs = qs.filter(organization_id=organization_id)
    if status:
        qs = qs.filter(status=status)
    return [serialize_invoice(inv, include_org=True) for inv in qs]


def list_invoices_for_store(organization_id):
    """Tenant-facing - issued/paid only, drafts are a FynkTech-side
    working document a store should never see."""
    qs = (
        Invoice.objects.filter(organization_id=organization_id, status__in=["issued", "paid"])
        .prefetch_related("lines")
    )
    return [serialize_invoice(inv) for inv in qs]


def get_invoice(invoice_id, *, organization_id=None, allowed_statuses=None):
    qs = Invoice.all_objects.select_related("organization").prefetch_related("lines")
    if organization_id:
        qs = qs.filter(organization_id=organization_id)
    try:
        invoice = qs.get(id=invoice_id)
    except Invoice.DoesNotExist as exc:
        raise InvoiceError("Invoice not found", 404) from exc
    if allowed_statuses and invoice.status not in allowed_statuses:
        raise InvoiceError("Invoice not found", 404)
    return invoice


@transaction.atomic
def generate_draft(*, organization_id, period_start, period_end, actor_user_id=None):
    """One dispatch-fee line, quantity = orders dispatched in the period,
    rate = this store's current Dispatch Hub rate - a starting point, not
    the final word; every field stays editable until issued."""
    try:
        organization = Organization.objects.get(id=organization_id)
    except Organization.DoesNotExist as exc:
        raise InvoiceError("Store not found", 404) from exc

    hub_entry = DispatchHubStore.objects.filter(organization_id=organization_id).first()
    rate = hub_entry.per_order_rate if hub_entry else Decimal("0")

    dispatched_count = Order.all_objects.filter(
        organization_id=organization_id,
        dispatched_at__date__gte=period_start,
        dispatched_at__date__lte=period_end,
    ).count()

    invoice = Invoice.all_objects.create(
        organization=organization,
        period_start=period_start,
        period_end=period_end,
        status="draft",
        created_by=actor_user_id,
    )
    InvoiceLine.all_objects.create(
        organization=organization,
        invoice=invoice,
        kind="dispatch_fee",
        description=f"Dispatch fee - {dispatched_count} order{'s' if dispatched_count != 1 else ''} "
        f"dispatched ({period_start} to {period_end})",
        quantity=dispatched_count,
        unit_price=rate,
        amount=Decimal(dispatched_count) * rate,
    )
    _recompute_totals(invoice)
    write_audit_log(
        organization_id=organization_id,
        action="invoice_draft_created",
        summary=f"Draft invoice created ({period_start} to {period_end})",
        actor_user_id=actor_user_id,
    )
    return invoice


@transaction.atomic
def set_lines(invoice, lines):
    """Replaces every line wholesale - simpler and safer than diffing an
    edit payload against existing rows, and the admin-only editor always
    sends the whole table back anyway."""
    if invoice.status != "draft":
        raise InvoiceError("Only a draft invoice can be edited")
    def _decimal(value, default):
        try:
            return Decimal(str(value))
        except (InvalidOperation, TypeError):
            return default

    invoice.lines.all().delete()
    for line in lines:
        quantity = _decimal(line.get("quantity"), Decimal("1"))
        unit_price = _decimal(line.get("unit_price"), Decimal("0"))
        InvoiceLine.all_objects.create(
            organization_id=invoice.organization_id,
            invoice=invoice,
            kind=line.get("kind") or "manual",
            description=(line.get("description") or "").strip()[:255] or "Line item",
            quantity=quantity,
            unit_price=unit_price,
            amount=quantity * unit_price,
        )
    _recompute_totals(invoice)
    return invoice


def _next_invoice_number(issued_at):
    year = issued_at.year
    count = Invoice.all_objects.filter(number__startswith=f"FT-INV-{year}-").count()
    return f"FT-INV-{year}-{count + 1:04d}"


@transaction.atomic
def issue_invoice(invoice, *, actor_user_id=None):
    if invoice.status != "draft":
        raise InvoiceError("Only a draft invoice can be issued")
    if not invoice.lines.exists():
        raise InvoiceError("Add at least one line before issuing")
    now = timezone.now()
    invoice.number = _next_invoice_number(now)
    invoice.status = "issued"
    invoice.issued_at = now
    invoice.save(update_fields=["number", "status", "issued_at", "updated_at"])
    write_audit_log(
        organization_id=invoice.organization_id,
        action="invoice_issued",
        summary=f"Invoice {invoice.number} issued (Rs {invoice.total})",
        actor_user_id=actor_user_id,
    )
    return invoice


def mark_paid(invoice, *, actor_user_id=None):
    if invoice.status != "issued":
        raise InvoiceError("Only an issued invoice can be marked paid")
    invoice.status = "paid"
    invoice.save(update_fields=["status", "updated_at"])
    write_audit_log(
        organization_id=invoice.organization_id,
        action="invoice_paid",
        summary=f"Invoice {invoice.number} marked paid",
        actor_user_id=actor_user_id,
    )
    return invoice


def void_invoice(invoice, *, actor_user_id=None):
    if invoice.status not in ("draft", "issued"):
        raise InvoiceError("A paid or already-void invoice can't be voided")
    invoice.status = "void"
    invoice.save(update_fields=["status", "updated_at"])
    write_audit_log(
        organization_id=invoice.organization_id,
        action="invoice_voided",
        summary=f"Invoice {invoice.number or '(draft)'} voided",
        actor_user_id=actor_user_id,
    )
    return invoice
