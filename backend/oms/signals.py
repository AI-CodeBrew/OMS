"""Event listeners for the oms app.

Nothing to subscribe to yet - oms is the first module built, so no other
app publishes an event it needs to react to. Follow this pattern when
that changes (e.g. a future "returns" module publishing return.created):

    from core.events import subscribe

    def _on_some_event(sender, payload, **kwargs):
        ...

    subscribe("some.event", _on_some_event)
"""
