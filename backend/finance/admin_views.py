from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.permissions import IsSuperAdmin

from . import invoice_service
from .invoice_service import InvoiceError
from .rendering import invoice_print_html


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def invoices(request):
    """?organization_id= / ?status= narrow the list; neither is required."""
    return Response(
        {
            "success": True,
            "invoices": invoice_service.list_invoices(
                organization_id=request.query_params.get("organization_id"),
                status=request.query_params.get("status"),
            ),
        }
    )


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def generate_invoice(request):
    body = request.data or {}
    try:
        invoice = invoice_service.generate_draft(
            organization_id=body.get("organization_id"),
            period_start=body.get("period_start"),
            period_end=body.get("period_end"),
            actor_user_id=request.user_id,
        )
    except InvoiceError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "invoice_error"},
            status=exc.status_code,
        )
    return Response(
        {"success": True, "invoice": invoice_service.serialize_invoice(invoice, include_org=True)},
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsSuperAdmin])
def invoice_detail(request, invoice_id):
    try:
        invoice = invoice_service.get_invoice(invoice_id)
        if request.method == "PATCH":
            body = request.data or {}
            if "lines" in body:
                invoice_service.set_lines(invoice, body.get("lines") or [])
            if "notes" in body:
                invoice.notes = body.get("notes") or ""
                invoice.save(update_fields=["notes", "updated_at"])
            if "due_date" in body:
                invoice.due_date = body.get("due_date") or None
                invoice.save(update_fields=["due_date", "updated_at"])
    except InvoiceError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "invoice_error"},
            status=exc.status_code,
        )
    return Response(
        {"success": True, "invoice": invoice_service.serialize_invoice(invoice, include_org=True)}
    )


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def issue_invoice_view(request, invoice_id):
    try:
        invoice = invoice_service.get_invoice(invoice_id)
        invoice_service.issue_invoice(invoice, actor_user_id=request.user_id)
    except InvoiceError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "invoice_error"},
            status=exc.status_code,
        )
    return Response(
        {"success": True, "invoice": invoice_service.serialize_invoice(invoice, include_org=True)}
    )


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def mark_invoice_paid(request, invoice_id):
    try:
        invoice = invoice_service.get_invoice(invoice_id)
        invoice_service.mark_paid(invoice, actor_user_id=request.user_id)
    except InvoiceError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "invoice_error"},
            status=exc.status_code,
        )
    return Response(
        {"success": True, "invoice": invoice_service.serialize_invoice(invoice, include_org=True)}
    )


@api_view(["POST"])
@permission_classes([IsSuperAdmin])
def void_invoice_view(request, invoice_id):
    try:
        invoice = invoice_service.get_invoice(invoice_id)
        invoice_service.void_invoice(invoice, actor_user_id=request.user_id)
    except InvoiceError as exc:
        return Response(
            {"success": False, "error": exc.message, "code": "invoice_error"},
            status=exc.status_code,
        )
    return Response(
        {"success": True, "invoice": invoice_service.serialize_invoice(invoice, include_org=True)}
    )


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def print_invoice(request, invoice_id):
    try:
        invoice = invoice_service.get_invoice(invoice_id)
    except InvoiceError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)
    return HttpResponse(invoice_print_html(invoice), content_type="text/html")
