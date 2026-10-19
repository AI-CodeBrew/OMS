"""Lookups behind the "All" orders CSV (OrderViewSet.export) that aren't a
plain Order field: the store owner's name, what the courier reported
(weight, proof of delivery), and the order's latest log line."""
import logging
import re
from concurrent.futures import ThreadPoolExecutor

from core import supabase_admin
from core.models import Membership

logger = logging.getLogger(__name__)


def client_names(organization_ids):
    """{organization_id: owner name} - the store's first org admin, as
    Supabase Auth knows them (Django keeps no user names). Their full name
    when they set one, else their email. One Auth call per store, not per
    order; a failed lookup just leaves that store's cell blank."""
    owners = {}
    for membership in (
        Membership.objects.filter(organization_id__in=organization_ids, role="org_admin")
        .order_by("created_at")
    ):
        owners.setdefault(membership.organization_id, membership.user_id)
    if not owners:
        return {}

    def fetch(item):
        organization_id, user_id = item
        try:
            user = supabase_admin.get_user(user_id) or {}
        except Exception:  # noqa: BLE001 - a missing name must not fail the export
            logger.warning("csv export: no owner name for org %s", organization_id)
            return organization_id, ""
        meta = user.get("user_metadata") or {}
        name = meta.get("full_name") or meta.get("name") or user.get("email") or ""
        return organization_id, name

    with ThreadPoolExecutor(max_workers=min(8, len(owners))) as pool:
        return dict(pool.map(fetch, owners.items()))


def _latest_shipment(order):
    """The order's newest PostEx/BarqRaftar shipment - both keep the
    courier's last tracking response on it. Expects both relations
    prefetched, newest first. Smartlane keeps no such record."""
    shipments = [*order.postex_shipments.all()[:1], *order.barqraftar_shipments.all()[:1]]
    return max(shipments, key=lambda s: s.booked_at, default=None)


def _walk(node, depth=0):
    """Every (key, value) pair in a courier payload, nested ones included."""
    if depth > 6:
        return
    if isinstance(node, dict):
        for key, value in node.items():
            yield str(key), value
            yield from _walk(value, depth + 1)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value, depth + 1)


def _payloads(shipment):
    history = getattr(shipment, "status_history", None) or getattr(shipment, "status_logs", None)
    return [shipment.last_payload, history or []]


# BarqRaftar's documented fields (barqraftar.pk/api-documentation): the
# parcel's `weight` as the courier weighed it (customer_weight_grams is
# what we declared at booking), and per delivery attempt a `proof_image`
# path relative to the folder below plus a `receiver_signature_url`.
_BARQRAFTAR_PROOF_BASE = "https://barqraftar.pk/storage/app/public/order_attempt_proofs/"

# PostEx's track-order response (checked on live data) carries
# `actualWeight` but no proof links at all - its delivery proofs exist only
# on the PostEx portal. Its weight falls back to a search by name in case
# actualWeight is ever missing, and proof links are still looked for in
# case PostEx starts sending them.
_WEIGHT_PREFERRED = ("actual", "charged", "billing", "billed", "final")
_PROOF_KEY = re.compile(r"proof|pod|image|img|signature|picture|photo|attachment|snapshot", re.I)


def _is_barqraftar(shipment):
    return hasattr(shipment, "status_logs")


def _barqraftar_proofs(payload):
    links = []
    for attempt in payload.get("order_attempts") or []:
        if not isinstance(attempt, dict):
            continue
        image = str(attempt.get("proof_image") or "").strip()
        if image:
            links.append(image if image.startswith("http") else _BARQRAFTAR_PROOF_BASE + image.lstrip("/"))
        signature = str(attempt.get("receiver_signature_url") or "").strip()
        if signature.startswith("http"):
            links.append(signature)
    return list(dict.fromkeys(links))


def courier_weight(order):
    """The weight the courier weighed the parcel at, as it reported it -
    blank when it hasn't (or the order wasn't booked through PostEx /
    BarqRaftar)."""
    shipment = _latest_shipment(order)
    if shipment is None:
        return ""
    # BarqRaftar's `weight`; PostEx's `actualWeight` (kg - confirmed on
    # live track-order responses).
    key = "weight" if _is_barqraftar(shipment) else "actualWeight"
    weight = (shipment.last_payload or {}).get(key)
    if weight not in (None, "", 0, "0"):
        return str(weight)
    if _is_barqraftar(shipment):
        return ""
    found = []
    for payload in _payloads(shipment):
        for key, value in _walk(payload):
            if "weight" not in key.lower() or isinstance(value, (dict, list, bool)):
                continue
            if value in (None, "", 0, "0"):
                continue
            found.append((key.lower(), str(value)))
    if not found:
        return ""
    for key, value in found:
        if any(word in key for word in _WEIGHT_PREFERRED):
            return value
    return found[0][1]


def courier_proofs(order):
    """Links to the proof pictures the courier attached (delivery photo,
    signature, ...), " | "-separated."""
    shipment = _latest_shipment(order)
    if shipment is None:
        return ""
    if _is_barqraftar(shipment):
        return " | ".join(_barqraftar_proofs(shipment.last_payload or {}))
    links = []
    for payload in _payloads(shipment):
        for key, value in _walk(payload):
            if (
                isinstance(value, str)
                and value.startswith(("http://", "https://"))
                and _PROOF_KEY.search(key)
                and value not in links
            ):
                links.append(value)
    return " | ".join(links)


def last_update(order, status_labels, when):
    """The order's most recent log line - its newest status change or note,
    whichever came last - plus the courier's latest word on the parcel.
    Reads the _last_* annotations OrderViewSet.export puts on the queryset."""
    entries = []
    if order._last_event_at:
        text = f"Status: {status_labels.get(order._last_event_to, order._last_event_to)}"
        if order._last_event_note:
            text += f" ({order._last_event_note})"
        entries.append((order._last_event_at, text))
    if order._last_note_at:
        entries.append((order._last_note_at, f"Note: {order._last_note_body}"))
    parts = []
    if entries:
        at, text = max(entries, key=lambda entry: entry[0])
        parts.append(f"{when(at)} {text}")
    if order.courier_status:
        parts.append(f"Courier: {order.courier_status}")
    return " | ".join(parts)
