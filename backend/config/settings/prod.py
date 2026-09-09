import os

from .base import *  # noqa: F401,F403

DEBUG = False

# Fly sets FLY_APP_NAME on every machine; DJANGO_ALLOWED_HOSTS is the
# explicit allow-list on top of it (the Vercel frontend's origin lives
# there, because Channels validates WebSocket Origin against ALLOWED_HOSTS
# rather than CORS_ORIGINS). Any other platform is still supported through
# DJANGO_ALLOWED_HOSTS alone - nothing here is Fly-only.
_hosts = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
    if h.strip()
]
# <app>.fly.dev is the hostname Fly's proxy serves on.
_fly_app = os.environ.get("FLY_APP_NAME", "").strip()
_fly_host = f"{_fly_app}.fly.dev" if _fly_app else ""
if _fly_host and _fly_host not in _hosts:
    _hosts.append(_fly_host)
# Local docker / health probes
if "localhost" not in _hosts:
    _hosts.append("localhost")
ALLOWED_HOSTS = _hosts or ["*"]

# Serve collected static files (admin CSS etc.) without a separate CDN.
MIDDLEWARE = [
    MIDDLEWARE[0],
    "whitenoise.middleware.WhiteNoiseMiddleware",
    *MIDDLEWARE[1:],
]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
]
if _fly_host:
    CSRF_TRUSTED_ORIGINS.append(f"https://{_fly_host}")
