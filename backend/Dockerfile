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
# Must match fly.toml's runtime [env] PLAYWRIGHT_BROWSERS_PATH=0 exactly.
# That setting only takes effect on the running machine - it does nothing
# for this build step unless it's also set here. Without it, install puts
# Chromium in the default ~/.cache/ms-playwright, the running container
# then looks in site-packages instead (because PLAYWRIGHT_BROWSERS_PATH=0
# *is* set there), finds nothing, and every PDF render fails with
# "Executable doesn't exist" - the bug this line fixes.
ENV PLAYWRIGHT_BROWSERS_PATH=0
# Needs to run as root (true for the whole Docker build, unlike Render's
# native Python buildpack) so its internal apt-get install for Chromium's
# system libraries actually succeeds - that's the real reason the browser
# was never present at runtime under the buildpack, not a path issue.
RUN playwright install --with-deps chromium

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

CMD ["sh", "-c", "daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application"]
