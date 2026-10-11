"""Notifications for a store's own users - the bell in its header. See
core.models.Notification; today only FynkTech's super admin editing one of
the store's orders creates one (oms.views.OrderViewSet.update)."""

from django.utils import timezone

from .models import Notification

RECENT_LIMIT = 30


def notify(organization_id, *, kind, title, message="", order=None, changes=None, actor_email=""):
    return Notification.all_objects.create(
        organization_id=organization_id,
        kind=kind,
        title=title[:255],
        message=message[:1000],
        order_id=order.id if order is not None else None,
        order_number=order.order_number if order is not None else "",
        changes=changes or [],
        actor_email=actor_email or "",
    )


def serialize(notification):
    return {
        "id": str(notification.id),
        "kind": notification.kind,
        "title": notification.title,
        "message": notification.message,
        "order_id": str(notification.order_id) if notification.order_id else None,
        "order_number": notification.order_number,
        "changes": notification.changes or [],
        "is_read": notification.read_at is not None,
        "created_at": notification.created_at.isoformat(),
    }


def recent(organization_id):
    """The store's latest notifications, newest first, and how many it
    hasn't read."""
    qs = Notification.all_objects.filter(organization_id=organization_id)
    return {
        "notifications": [serialize(n) for n in qs.order_by("-created_at")[:RECENT_LIMIT]],
        "unread_count": qs.filter(read_at__isnull=True).count(),
    }


def mark_read(organization_id, ids=None):
    """Marks the given notifications (or all) of the store as read."""
    qs = Notification.all_objects.filter(organization_id=organization_id, read_at__isnull=True)
    if ids:
        qs = qs.filter(id__in=ids)
    return qs.update(read_at=timezone.now())
