import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

# backend/config/settings/base.py -> backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env.backend")


def env(key, default=None, required=False):
    value = os.environ.get(key, default)
    if required and not value:
        raise RuntimeError(f"{key} is not set (expected in backend/.env.backend)")
    return value


SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-secret-key-change-me")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "oms",
    "wms",
    "finance",
    "integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Resolves organization_id/user_id/is_super_admin from the Supabase JWT
    # for every request; must run before any view or DRF permission check.
    "core.middleware.TenantMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# --- Database ---------------------------------------------------------------
# DATABASE_URL must be Supabase's *pooler* connection string (session or
# transaction mode). Supabase's direct-connection host is IPv6-only; on a
# network without IPv6 egress it fails DNS/connect entirely.
_db_url = env("DATABASE_URL", required=True)
_db = urlparse(_db_url)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _db.path.lstrip("/"),
        # urlparse does NOT percent-decode credentials - a password with
        # special characters (@, !, etc.) will silently fail auth without
        # this unquote().
        "USER": unquote(_db.username or ""),
        "PASSWORD": unquote(_db.password or ""),
        "HOST": _db.hostname,
        "PORT": _db.port or 5432,
        # Without this, a DNS/network blip while connecting to Supabase's
        # pooler hangs indefinitely instead of raising - which is fatal for
        # the background Shopify sync thread specifically: a hung connect()
        # call inside job.save() never raises an exception for the thread's
        # own try/except to catch, so it just silently stops making
        # progress instead of failing loudly. A short timeout turns that
        # into a real, catchable OperationalError instead.
        "OPTIONS": {"connect_timeout": 10},
    }
}


# --- Supabase -----------------------------------------------------------
SUPABASE_URL = env("SUPABASE_URL", required=True)
SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", required=True)
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", required=True)


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    # Reads identity already parsed by TenantMiddleware - never re-decodes
    # the JWT.
    "DEFAULT_AUTHENTICATION_CLASSES": ["core.authentication.SupabaseJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

_cors_origins = env("CORS_ORIGINS", default="http://localhost:3000")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins.split(",") if o.strip()]


# --- Integrations ---------------------------------------------------------
SHOPIFY_API_VERSION = env("SHOPIFY_API_VERSION", default="2024-10")
# Must be a publicly reachable URL for Shopify's webhook deliveries to
# actually arrive - on localhost, webhook registration succeeds but
# delivery never will until this is tunneled (ngrok etc.) or deployed.
PUBLIC_BACKEND_URL = env("PUBLIC_BACKEND_URL", default="http://localhost:8000")
