from django.urls import path

from . import admin_views

urlpatterns = [
    path("", admin_views.invoices, name="admin-invoices"),
    path("generate/", admin_views.generate_invoice, name="admin-invoice-generate"),
    path("<uuid:invoice_id>/", admin_views.invoice_detail, name="admin-invoice-detail"),
    path("<uuid:invoice_id>/issue/", admin_views.issue_invoice_view, name="admin-invoice-issue"),
    path("<uuid:invoice_id>/paid/", admin_views.mark_invoice_paid, name="admin-invoice-paid"),
    path("<uuid:invoice_id>/void/", admin_views.void_invoice_view, name="admin-invoice-void"),
    path("<uuid:invoice_id>/print/", admin_views.print_invoice, name="admin-invoice-print"),
]
