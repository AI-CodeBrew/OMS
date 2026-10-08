import os

from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "integrations"

    def ready(self):
        from django.conf import settings

        # manage.py runserver's autoreloader runs ready() twice (the parent
        # watcher, then the reloaded child that sets RUN_MAIN) - only start
        # in the child so local dev doesn't end up with two poller threads.
        # Production runs a single `daphne` process directly (no runserver,
        # no autoreloader), where RUN_MAIN is simply never set. Checked
        # once, ahead of either poller below, so both are gated the same
        # way Smartlane's always was.
        if "RUN_MAIN" in os.environ and os.environ.get("RUN_MAIN") != "true":
            return

        if settings.SMARTLANE_AUTO_POLL:
            from . import poller

            poller.start_background_poller()

        # Independent flag/thread/module from Smartlane's poller just
        # above - see integrations/barqraftar/poller.py. Off unless
        # BARQRAFTAR_AUTO_POLL is set, same convention as Smartlane's own
        # flag (config/settings/base.py).
        if settings.BARQRAFTAR_AUTO_POLL:
            from .barqraftar import poller as barqraftar_poller

            barqraftar_poller.start_background_poller()

        # PostEx's own poller (integrations/postex/poller.py) - independent
        # flag/thread/module, same convention as the two above - the backup
        # behind PostEx's status webhook.
        if settings.POSTEX_AUTO_POLL:
            from .postex import poller as postex_poller

            postex_poller.start_background_poller()
