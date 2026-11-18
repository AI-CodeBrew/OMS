"""The super admin side's Receivings page (user, 2026-11-18): photos of a
courier's load sheet handed back at pickup, of returned parcels, or of new
inventory, picked from the phone's gallery and kept in Bunny next to the
print batches (oms.storage).

Mounted under /api/core/admin/receivings/ (core/urls.py) so the admin IP
allowlist and the super admin page limits (core.admin_pages "receivings")
cover it, like the city list.

    GET    /                       latest receivings (+ ?kind=) and the courier list
    POST   /                       multipart: kind, courier, received_on (yyyy-mm-dd), note, images
    DELETE /<id>/                  a receiving and its pictures
    GET    /images/<image id>/     one picture (the zone is private - never a public URL)
"""

import datetime
import logging
import os
import uuid

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from core.permissions import IsSuperAdmin

from .models import Courier, Receiving, ReceivingImage

logger = logging.getLogger(__name__)

MAX_IMAGES = 20
MAX_IMAGE_BYTES = 15 * 1024 * 1024
LIST_LIMIT = 50
KINDS = {key for key, _label in Receiving.KIND_CHOICES}
# Load sheets and returns come from a courier; inventory may come from a
# supplier, so its courier is optional.
COURIER_REQUIRED = {Receiving.KIND_LOADSHEET, Receiving.KIND_RETURN}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"}


def courier_names():
    """Every courier name any store uses, once each (Leopards / leopards
    are one), A-Z."""
    names = {}
    for name in Courier.all_objects.filter(is_active=True).values_list("name", flat=True):
        name = (name or "").strip()
        if name:
            names.setdefault(name.lower(), name)
    return sorted(names.values(), key=str.lower)


def _image_json(image):
    return {"id": str(image.id), "name": image.original_name, "size": image.size, "content_type": image.content_type}


def _receiving_json(receiving):
    return {
        "id": str(receiving.id),
        "kind": receiving.kind,
        "kind_label": receiving.get_kind_display(),
        "courier": receiving.courier,
        "received_on": receiving.received_on.isoformat(),
        "note": receiving.note,
        "created_at": receiving.created_at.isoformat(),
        "created_by_email": receiving.created_by_email,
        "images": [_image_json(i) for i in receiving.images.all()],
    }


def _error(message, status=400):
    return Response({"success": False, "error": message}, status=status)


def _safe_name(name):
    base, ext = os.path.splitext(os.path.basename(name or "image"))
    base = "".join(c if c.isalnum() or c in "-_" else "_" for c in base)[:60] or "image"
    return f"{base}{ext.lower()[:8]}"


def _is_image(upload):
    content_type = (getattr(upload, "content_type", "") or "").lower()
    ext = os.path.splitext(upload.name or "")[1].lower()
    return content_type.startswith("image/") or ext in IMAGE_EXTENSIONS


@api_view(["GET", "POST"])
@permission_classes([IsSuperAdmin])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def receivings(request):
    if request.method == "GET":
        qs = Receiving.objects.prefetch_related("images")
        kind = request.query_params.get("kind") or ""
        if kind in KINDS:
            qs = qs.filter(kind=kind)
        counts = {k: Receiving.objects.filter(kind=k).count() for k in KINDS}
        return Response({
            "success": True,
            "receivings": [_receiving_json(r) for r in qs[:LIST_LIMIT]],
            "counts": counts,
            "couriers": courier_names(),
        })

    kind = (request.data.get("kind") or "").strip()
    courier = (request.data.get("courier") or "").strip()[:150]
    note = (request.data.get("note") or "").strip()[:2000]
    uploads = request.FILES.getlist("images")
    raw_date = (request.data.get("received_on") or "").strip()
    try:
        received_on = parse_date(raw_date) if raw_date else timezone.localdate()
    except ValueError:
        received_on = None
    if kind not in KINDS:
        return _error("Pick Load Sheet, Return or Inventory Receiving.")
    if kind in COURIER_REQUIRED and not courier:
        return _error("Pick a courier.")
    if received_on is None:
        return _error("Pick a valid date.")
    if received_on > timezone.localdate() + datetime.timedelta(days=1):
        return _error("The date can't be in the future.")
    if not uploads:
        return _error("Choose at least one picture.")
    if len(uploads) > MAX_IMAGES:
        return _error(f"At most {MAX_IMAGES} pictures at a time.")
    for upload in uploads:
        if not _is_image(upload):
            return _error(f"{upload.name} isn't a picture.")
        if upload.size > MAX_IMAGE_BYTES:
            return _error(f"{upload.name} is bigger than 15 MB.")

    saved = []
    try:
        with transaction.atomic():
            receiving = Receiving.objects.create(
                kind=kind,
                courier=courier,
                received_on=received_on,
                note=note,
                created_by_user_id=getattr(request, "user_id", None),
                created_by_email=getattr(request, "auth_email", "") or "",
            )
            for upload in uploads:
                image = ReceivingImage(
                    id=uuid.uuid4(),
                    receiving=receiving,
                    original_name=(upload.name or "")[:255],
                    content_type=(getattr(upload, "content_type", "") or "image/jpeg")[:100],
                    size=upload.size or 0,
                )
                # Uploads to Bunny here; a failure rolls the rows back.
                image.file.save(_safe_name(upload.name), upload, save=False)
                saved.append(image.file.name)
                image.save()
    except Exception:
        logger.exception("receivings: upload failed")
        # Rows rolled back - don't leave the pictures already sent behind.
        for name in saved:
            ReceivingImage.file.field.storage.delete(name)
        return _error("Couldn't save the pictures - please try again.", 502)

    receiving = Receiving.objects.prefetch_related("images").get(id=receiving.id)
    return Response({"success": True, "receiving": _receiving_json(receiving)}, status=201)


@api_view(["DELETE"])
@permission_classes([IsSuperAdmin])
def receiving_detail(request, receiving_id):
    receiving = Receiving.objects.filter(id=receiving_id).first()
    if receiving is None:
        return _error("Receiving not found.", 404)
    names = [i.file.name for i in receiving.images.all()]
    receiving.delete()
    storage = ReceivingImage.file.field.storage
    for name in names:
        storage.delete(name)
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsSuperAdmin])
def receiving_image(request, image_id):
    image = ReceivingImage.objects.filter(id=image_id).first()
    if image is None:
        return _error("Picture not found.", 404)
    try:
        with image.file.open("rb") as handle:
            data = handle.read()
    except FileNotFoundError:
        return _error("Picture not found in storage.", 404)
    response = HttpResponse(data, content_type=image.content_type or "image/jpeg")
    response["Content-Disposition"] = f'inline; filename="{_safe_name(image.original_name)}"'
    response["Cache-Control"] = "private, max-age=86400"
    return response
