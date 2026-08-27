from django.contrib import admin
from django.urls import include, path

from core.views import health_plain

urlpatterns = [
    path("admin/", admin.site.urls),
    # Minimal plain-text probe: GET /health → "ok"
    path("health", health_plain, name="health-root"),
    path("health/", health_plain, name="health-root-slash"),
    path("api/core/", include("core.urls")),
    path("api/oms/", include("oms.urls")),
    path("api/wms/", include("wms.urls")),
    path("api/integrations/", include("integrations.urls")),
    # finance/ is added here once its urls.py exists.
]
