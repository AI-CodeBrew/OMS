FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# collectstatic needs settings imports; dummy values are fine at image build.
# Real secrets are injected by Render at runtime.
ARG DJANGO_SECRET_KEY=build-time-only
ARG DATABASE_URL=postgresql://u:p@localhost:5432/db
ARG SUPABASE_URL=https://example.supabase.co
ARG SUPABASE_SERVICE_ROLE_KEY=build
ARG SUPABASE_JWT_SECRET=build
ENV DJANGO_SECRET_KEY=$DJANGO_SECRET_KEY \
    DATABASE_URL=$DATABASE_URL \
    SUPABASE_URL=$SUPABASE_URL \
    SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
    SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["sh", "-c", "gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000}"]
