from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/core/", include("core.urls")),
    path("api/oms/", include("oms.urls")),
    path("api/integrations/", include("integrations.urls")),
    # wms/ and finance/ are added here once their urls.py exist.
]
