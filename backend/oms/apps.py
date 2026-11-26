from django.apps import AppConfig


class OmsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "oms"

    def ready(self):
        import os

        from django.conf import settings

        from . import signals  # noqa: F401

        # Auto Shipper Advice's background check (oms.auto_advice) - same
        # start rule as the courier pollers (integrations/apps.py): not in
        # runserver's watcher process, nor in `RUN_MAIN=false` shells.
        if "RUN_MAIN" in os.environ and os.environ.get("RUN_MAIN") != "true":
            return
        # Only in the web server (daphne in production, runserver locally) -
        # never in `manage.py shell / migrate / check`, so a shell opened on
        # the server doesn't start a second runner next to the app's.
        import sys

        program = os.path.basename(sys.argv[0]) if sys.argv else ""
        if program in ("manage.py", "django-admin") and (len(sys.argv) < 2 or sys.argv[1] != "runserver"):
            return
        if settings.AUTO_SHIPPER_ADVICE_MODE in ("dry_run", "live"):
            from . import auto_advice

            auto_advice.start_background_runner()
