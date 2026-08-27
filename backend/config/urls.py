from django.contrib import admin
from django.urls import include, path

from core.views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    # Public health for Render / load balancers: /health and /health/
    path("health", health, name="health-root"),
    path("health/", health, name="health-root-slash"),
    path("api/core/", include("core.urls")),
    path("api/oms/", include("oms.urls")),
    path("api/wms/", include("wms.urls")),
    path("api/integrations/", include("integrations.urls")),
    # finance/ is added here once its urls.py exists.
]
