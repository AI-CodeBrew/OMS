import os

from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "integrations"

    def ready(self):
        from django.conf import settings

        if not settings.SMARTLANE_AUTO_POLL:
            return
        # manage.py runserver's autoreloader runs ready() twice (the parent
        # watcher, then the reloaded child that sets RUN_MAIN) - only start
        # in the child so local dev doesn't end up with two poller threads.
        # Production runs a single `daphne` process directly (no runserver,
        # no autoreloader), where RUN_MAIN is simply never set.
        if "RUN_MAIN" in os.environ and os.environ.get("RUN_MAIN") != "true":
            return

        from . import poller

        poller.start_background_poller()
