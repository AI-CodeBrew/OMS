from django.dispatch import Signal

_signals = {}


def _signal_for(event_name):
    if event_name not in _signals:
        _signals[event_name] = Signal()
    return _signals[event_name]


def publish_event(event_name, payload):
    """Fire an event by name. Runs synchronously today - receivers execute
    in-process, inline with the request that published it. When
    background tasks (Celery) are introduced, only the receiver functions
    registered via subscribe() need to change to enqueue a task instead of
    doing the work inline; every publish_event() call site stays the
    same."""
    _signal_for(event_name).send(sender=event_name, payload=payload)


def subscribe(event_name, receiver):
    """Register `receiver(sender, payload, **kwargs)` for `event_name`.
    Call from an app's signals.py, imported by that app's AppConfig.ready()
    so the registration happens once at startup."""
    _signal_for(event_name).connect(receiver, weak=False)
