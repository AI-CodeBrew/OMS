from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        from . import access_cache, realtime

        realtime.register()
        access_cache.connect_signals()
