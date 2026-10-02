from django.urls import path

from . import views

urlpatterns = [
    path("bank-details/", views.bank_details, name="bank-details"),
]
