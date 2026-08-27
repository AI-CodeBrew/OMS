"""
OMS — Multi-tenant Order Management System

================================================================================
READ FIRST — AGENT / CONTRIBUTOR RULES (always apply)
================================================================================

1. Always read this file before making non-trivial changes, and re-check it
   before any action that is security-sensitive or performance-sensitive.

2. NEVER take a security-critical step without asking the user first. Examples:
   - Changing auth, JWT, RLS, permissions, or CORS
   - Creating/deleting users, resetting passwords, rotating secrets
   - Exposing service-role keys, tokens, or env values
   - Disabling auth checks, opening public endpoints, or widening tenant scope
   - Production deploys, force-pushes, or irreversible data/schema changes
   When in doubt: ASK, then wait for confirmation.

3. NEVER make the system slower on page load. Keep pages fast and optimized:
   - Load ONLY the data needed for the current page / visible view
   - No fetching entire catalogs, all tenants, or unrelated modules "just in case"
   - Prefer pagination, filters, and scoped queries over bulk loads
   - Avoid N+1 queries, heavy joins on list pages, and blocking third-party calls
     in the request cycle (use queues for Shopify/WhatsApp/robocall/sync work)
   - Do not add large client bundles, unoptimized images, or unnecessary
     global state that re-fetches on every navigation
   If a change could hurt load speed or over-fetch data: ASK the user first.

4. For any action that is security-critical OR may slow page loads / over-fetch:
   stop, explain the risk briefly, and ask the user before proceeding.

================================================================================
ENVIRONMENT VARIABLES (names only — never commit values)
================================================================================

Backend (backend/.env.backend):
  DJANGO_SECRET_KEY
  DJANGO_SETTINGS_MODULE
  DJANGO_ALLOWED_HOSTS
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
  DATABASE_URL
  CORS_ORIGINS
  PUBLIC_BACKEND_URL
  SHOPIFY_API_VERSION
  PORT
  SUPER_ADMIN_EMAIL          # fill, then: python manage.py bootstrap_super_admin
  SUPER_ADMIN_PASSWORD       # fill, then run bootstrap (never commit real values)
  ADMIN_IP_ALLOWLIST         # comma-separated IPs allowed for /api/core/admin/*

Frontend (frontend/.env.local):
  NEXT_PUBLIC_API_BASE_URL
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_FEATURE_FLAGS
  ADMIN_IP_ALLOWLIST         # server-only; hide /superadmin + /admin if IP not allowed (set on Vercel too)

================================================================================
ARCHITECTURE
================================================================================

project/
├── frontend/   # Next.js multi-tenant dashboard
└── backend/    # Django API (Render) + Supabase Auth/Postgres

Tenancy: organization_id on business tables; JWT app_metadata carries role + org.
Super admin: /superadmin login → /admin/organizations (sidebar: Organizations, Users; IP-allowlisted); org users: /login → /dashboard.
Async third-party work must not block request/response cycles.

================================================================================
LOCAL DEV
================================================================================

1. Copy env examples:
   cp backend/.env.example backend/.env.backend
   cp frontend/.env.example frontend/.env.local

2. Backend:
   cd backend && python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   python run.py

3. Frontend:
   cd frontend && npm install && npm run dev

4. Smoke path:
   Login at /login → Supabase JWT → GET /api/core/health/protected
   Super admin → /admin ; org user → /dashboard

5. Bootstrap super admin (after filling SUPER_ADMIN_* in .env.backend):
   cd backend && source .venv/bin/activate
   python manage.py bootstrap_super_admin
"""
