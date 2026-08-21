from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("health/protected/", views.health_protected, name="health-protected"),
]
