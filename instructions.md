"""
OMS — Multi-tenant Order Management System

================================================================================
ENVIRONMENT VARIABLES (names only — never commit values)
================================================================================

Backend (backend/.env):
  FLASK_ENV
  FLASK_DEBUG
  SECRET_KEY
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
  REDIS_URL
  CELERY_BROKER_URL
  CELERY_RESULT_BACKEND
  SHOPIFY_API_VERSION
  WHATSAPP_API_URL
  WHATSAPP_API_TOKEN
  ROBOCALL_API_URL
  ROBOCALL_API_TOKEN
  CORS_ORIGINS
  PORT

Frontend (frontend/.env.local):
  NEXT_PUBLIC_API_BASE_URL
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_FEATURE_FLAGS

================================================================================
ARCHITECTURE
================================================================================

project/
├── frontend/   # Next.js multi-tenant dashboard
└── backend/    # Flask API + Celery workers

See the project brief for module layout, tenancy, and async rules.
Current scaffold wires: auth (login/me) + health (public + JWT-protected).

================================================================================
LOCAL DEV
================================================================================

1. Copy env examples:
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local

2. Apply migrations/001_initial_schema.sql in Supabase SQL editor.

3. Backend:
   cd backend && python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   python wsgi.py

4. Frontend:
   cd frontend && npm install && npm run dev

5. Smoke path:
   Login at /login → backend /api/v1/auth/login → JWT stored →
   GET /api/v1/health/protected with Authorization: Bearer <token>
"""
