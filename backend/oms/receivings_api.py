"""A store's Receivings page - OMS, below Critical Orders (user,
2026-11-18): photos of a courier's load sheet handed back at pickup, of
returned parcels, or of new inventory, picked from the phone's gallery and
kept in Bunny next to the print batches (oms.storage).

Each receiving belongs to the store it was added in. An organization with
several stores (core.org_group) sees all of its stores' receivings on every
store's page, with the store's name; the store admin gives staff the page
through their role ("Receivings").

    GET    /api/oms/receivings/                  latest receivings (+ ?kind=) and the courier list
    POST   /api/oms/receivings/                  multipart: kind, courier, received_on, note, images
    DELETE /api/oms/receivings/<id>/             a receiving and its pictures
    GET    /api/oms/receivings/images/<id>/      one picture (the zone is private - no public URL)
"""

import datetime
import logging
import os
import uuid

from django.db import transaction
from django.db.models import Prefetch
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from core import org_group
from core.models import Organization
from core.permissions import RequireModule

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


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": message}, status=code)


def _safe_name(name):
    base, ext = os.path.splitext(os.path.basename(name or "image"))
    base = "".join(c if c.isalnum() or c in "-_" else "_" for c in base)[:60] or "image"
    return f"{base}{ext.lower()[:8]}"


def _is_image(upload):
    content_type = (getattr(upload, "content_type", "") or "").lower()
    ext = os.path.splitext(upload.name or "")[1].lower()
    return content_type.startswith("image/") or ext in IMAGE_EXTENSIONS


class ReceivingViewSet(viewsets.ViewSet):
    permission_classes = [RequireModule]
    required_module = "oms"
    page_access = {"*": {"read": ("oms.receivings",), "write": ("oms.receivings",)}}
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # -- scope ------------------------------------------------------------

    def _store_ids(self, request):
        """Every store of this store's organization - just this one when it
        stands alone."""
        return org_group.group_ids(request.organization_id) or [str(request.organization_id)]

    def _receivings(self, request):
        # Pictures through all_objects: the default (tenant) manager would
        # drop another store's pictures from the organization's list.
        return Receiving.all_objects.filter(organization_id__in=self._store_ids(request)).prefetch_related(
            Prefetch("images", queryset=ReceivingImage.all_objects.order_by("created_at"))
        )

    def _courier_names(self, request):
        names = {}
        for name in Courier.all_objects.filter(
            organization_id__in=self._store_ids(request), is_active=True
        ).values_list("name", flat=True):
            name = (name or "").strip()
            if name:
                names.setdefault(name.lower(), name)
        return sorted(names.values(), key=str.lower)

    def _json(self, receiving, store_names):
        return {
            "id": str(receiving.id),
            "kind": receiving.kind,
            "kind_label": receiving.get_kind_display(),
            "courier": receiving.courier,
            "received_on": receiving.received_on.isoformat(),
            "note": receiving.note,
            "store": store_names.get(str(receiving.organization_id), ""),
            "created_at": receiving.created_at.isoformat(),
            "created_by_email": receiving.created_by_email,
            "images": [
                {"id": str(i.id), "name": i.original_name, "size": i.size, "content_type": i.content_type}
                for i in receiving.images.all()
            ],
        }

    def _store_names(self, request):
        ids = self._store_ids(request)
        if len(ids) < 2:
            return {}
        return {str(i): n for i, n in Organization.objects.filter(id__in=ids).values_list("id", "name")}

    # -- endpoints --------------------------------------------------------

    def list(self, request):
        qs = self._receivings(request)
        kind = request.query_params.get("kind") or ""
        if kind in KINDS:
            qs = qs.filter(kind=kind)
        counts = {k: Receiving.all_objects.filter(organization_id__in=self._store_ids(request), kind=k).count() for k in KINDS}
        names = self._store_names(request)
        return Response({
            "receivings": [self._json(r, names) for r in qs[:LIST_LIMIT]],
            "counts": counts,
            "couriers": self._courier_names(request),
            "grouped": bool(names),
        })

    def create(self, request):
        data = request.data
        kind = (data.get("kind") or "").strip()
        courier = (data.get("courier") or "").strip()[:150]
        note = (data.get("note") or "").strip()[:2000]
        uploads = request.FILES.getlist("images")
        raw_date = (data.get("received_on") or "").strip()
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

        store_id = request.organization_id
        saved = []
        try:
            with transaction.atomic():
                receiving = Receiving.all_objects.create(
                    organization_id=store_id,
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
                        organization_id=store_id,
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
            return _error("Couldn't save the pictures - please try again.", status.HTTP_502_BAD_GATEWAY)

        receiving = self._receivings(request).get(id=receiving.id)
        return Response({"receiving": self._json(receiving, self._store_names(request))}, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        receiving = self._receivings(request).filter(id=pk).first()
        if receiving is None:
            return _error("Receiving not found.", status.HTTP_404_NOT_FOUND)
        names = [i.file.name for i in receiving.images.all()]
        receiving.delete()
        storage = ReceivingImage.file.field.storage
        for name in names:
            storage.delete(name)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path=r"images/(?P<image_id>[0-9a-f-]{36})")
    def image(self, request, image_id=None):
        image = ReceivingImage.all_objects.filter(
            id=image_id, organization_id__in=self._store_ids(request)
        ).first()
        if image is None:
            return _error("Picture not found.", status.HTTP_404_NOT_FOUND)
        try:
            with image.file.open("rb") as handle:
                data = handle.read()
        except FileNotFoundError:
            return _error("Picture not found in storage.", status.HTTP_404_NOT_FOUND)
        response = HttpResponse(data, content_type=image.content_type or "image/jpeg")
        response["Content-Disposition"] = f'inline; filename="{_safe_name(image.original_name)}"'
        response["Cache-Control"] = "private, max-age=86400"
        return response
