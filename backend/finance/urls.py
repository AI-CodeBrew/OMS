from django.urls import path

from . import views

urlpatterns = [
    path("bank-details/", views.bank_details, name="bank-details"),
    path("invoices/", views.invoices, name="invoices"),
    path("invoices/<uuid:invoice_id>/", views.invoice_detail, name="invoice-detail"),
    path("invoices/<uuid:invoice_id>/print/", views.print_invoice, name="invoice-print"),
]
