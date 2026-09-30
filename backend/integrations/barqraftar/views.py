import hashlib
import hmac
import io
import json
import logging
import threading

from django.core.files.base import ContentFile
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.middleware import get_client_ip
from core.permissions import IsOrgAdmin, RequireModule
from core.rbac import write_audit_log

from . import client, services
from .client import BarqRaftarAPIError
from .exceptions import BarqRaftarBookingError
from .models import BarqRaftarConnection, BarqRaftarSyncJob
from .serializers import (
    BarqRaftarConnectionSerializer,
    BarqRaftarStatusSerializer,
    BarqRaftarSyncJobSerializer,
)

logger = logging.getLogger(__name__)

# Same shape/reasoning as oms/views.py's STALE_JOB_SECONDS - a job saves
# progress at least once per chunk, so anything "running"/"pending" that
# hasn't been touched this long has no live thread behind it any more
# (almost always a runserver auto-reload).
STALE_JOB_SECONDS = 180


class BarqRaftarConnectionView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"connected": False})
        data = BarqRaftarConnectionSerializer(connection, context={"request": request}).data
        data["connected"] = True
        return Response(data)

    def post(self, request):
        api_key = (request.data.get("api_key") or "").strip()
        api_secret = (request.data.get("api_secret") or "").strip()
        if not api_key or not api_secret:
            return Response(
                {"detail": "api_key and api_secret are required"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        # Cheap validation before saving - fetch_cities is the lightest
        # authenticated call BarqRaftar's API offers.
        try:
            client.fetch_cities(api_key, api_secret)
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        connection, _ = BarqRaftarConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={"api_key": api_key, "api_secret": api_secret, "is_connected": True},
        )
        write_audit_log(
            organization_id=request.organization_id,
            action="integrations.barqraftar.connect",
            summary="Connected BarqRaftar",
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
            entity_type="barqraftar_connection",
            entity_id=str(connection.id),
            metadata={},
        )
        data = BarqRaftarConnectionSerializer(connection, context={"request": request}).data
        data["connected"] = True
        return Response(data, status=http_status.HTTP_201_CREATED)

    def patch(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)

        fields = []
        for key in ("default_weight_grams", "label_format"):
            if key in request.data:
                setattr(connection, key, request.data[key])
                fields.append(key)
        if "pickup_address_id" in request.data:
            connection.pickup_address_id = (request.data.get("pickup_address_id") or "").strip()
            connection.pickup_address_label = (request.data.get("pickup_address_label") or "").strip()
            fields += ["pickup_address_id", "pickup_address_label"]
        if "from_city_id" in request.data:
            connection.from_city_id = str(request.data.get("from_city_id") or "").strip()
            connection.from_city_name = (request.data.get("from_city_name") or "").strip()
            fields += ["from_city_id", "from_city_name"]
        if "city_aliases" in request.data and isinstance(request.data.get("city_aliases"), dict):
            connection.city_aliases = request.data["city_aliases"]
            fields.append("city_aliases")

        if fields:
            connection.save(update_fields=fields)
        data = BarqRaftarConnectionSerializer(connection, context={"request": request}).data
        data["connected"] = True
        return Response(data)

    def delete(self, request):
        connection = BarqRaftarConnection.objects.filter(organization_id=request.organization_id).first()
        if connection:
            connection.is_connected = False
            connection.save(update_fields=["is_connected"])
            write_audit_log(
                organization_id=request.organization_id,
                action="integrations.barqraftar.disconnect",
                summary="Disconnected BarqRaftar",
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                entity_type="barqraftar_connection",
                entity_id=str(connection.id),
                metadata={},
            )
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class BarqRaftarStatusView(APIView):
    """Read by the orders page (any oms staff, not just org admins) to
    decide whether to show "Book with BarqRaftar" / "Print BarqRaftar
    Labels" at all - the main connection view above is IsOrgAdmin-only, the
    same restriction Smartlane's status endpoint has, which is why
    non-admin staff never see the Smartlane action there either."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        connected = bool(connection)
        ready_to_book = bool(connected and connection.pickup_address_id and connection.from_city_id)
        return Response(
            BarqRaftarStatusSerializer({"connected": connected, "ready_to_book": ready_to_book}).data
        )


def _mark_stale_job_failed(job):
    job.status = "failed"
    job.error_message = (
        f"Sync stalled after {job.checked_count} shipment(s) (likely a server restart) - "
        "click Sync to try again."
    )
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at"])


class BarqRaftarSyncView(APIView):
    """Same shape as integrations.views.SmartlaneSyncView - kicks off a
    background poll and returns immediately; poll GET for progress."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        job = BarqRaftarSyncJob.objects.filter(organization_id=request.organization_id).first()
        if not job:
            return Response({"status": "idle"})
        if job.status in ("pending", "running"):
            age = (timezone.now() - job.updated_at).total_seconds()
            if age > STALE_JOB_SECONDS:
                _mark_stale_job_failed(job)
        return Response(BarqRaftarSyncJobSerializer(job).data)

    def delete(self, request):
        job = BarqRaftarSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if not job:
            return Response({"detail": "No sync in progress"}, status=http_status.HTTP_400_BAD_REQUEST)
        job.cancel_requested = True
        job.status = "cancelled"
        job.finished_at = timezone.now()
        job.save(update_fields=["cancel_requested", "status", "finished_at"])
        return Response(BarqRaftarSyncJobSerializer(job).data)

    def post(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)

        existing = BarqRaftarSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if existing:
            age = (timezone.now() - existing.updated_at).total_seconds()
            if age <= STALE_JOB_SECONDS:
                return Response(
                    {"detail": "A sync is already in progress"}, status=http_status.HTTP_409_CONFLICT
                )
            _mark_stale_job_failed(existing)

        job = BarqRaftarSyncJob.objects.create(organization_id=request.organization_id)
        thread = threading.Thread(
            target=services.run_barqraftar_sync, args=(request.organization_id, job.id), daemon=True,
        )
        thread.start()
        return Response(BarqRaftarSyncJobSerializer(job).data, status=http_status.HTTP_202_ACCEPTED)


class BarqRaftarCityListView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        force_refresh = request.query_params.get("refresh") == "1"
        try:
            cities = services.get_cities(connection, force_refresh=force_refresh)
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        return Response({"cities": cities, "aliases": connection.city_aliases})


class BarqRaftarPickupAddressesView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            addresses = client.list_pickup_addresses(connection.api_key, connection.api_secret)
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        return Response({"addresses": addresses, "active_id": connection.pickup_address_id})

    def post(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)

        data = request.data
        try:
            result = client.save_pickup_address(
                connection.api_key, connection.api_secret,
                pickup_address_id=data.get("pickup_address_id"),
                name=data.get("name", ""),
                address=data.get("address", ""),
                city_id=data.get("city_id", ""),
                person_of_contact=data.get("person_of_contact", ""),
                phone_number=data.get("phone_number", ""),
                latitude=data.get("latitude"),
                longitude=data.get("longitude"),
            )
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)

        # BarqRaftar answers {"status": true, "message": ..., "pickup_address_id":
        # <new id>} (confirmed live). The origin city follows the address.
        if data.get("set_default"):
            saved_id = result.get("pickup_address_id") if isinstance(result, dict) else None
            if saved_id:
                connection.pickup_address_id = str(saved_id)
                connection.pickup_address_label = data.get("name", "")
                connection.from_city_id = str(data.get("city_id", "")).strip()
                connection.from_city_name = (data.get("city_name") or "").strip()
                connection.save(update_fields=[
                    "pickup_address_id", "pickup_address_label", "from_city_id", "from_city_name", "updated_at",
                ])

        return Response(result if isinstance(result, dict) else {"result": result})


class BarqRaftarShipmentsView(APIView):
    """Proxies BarqRaftar's own GET /orders listing, with whatever filters
    the Shipments tab sends - deliberately not read from our local
    BarqRaftarShipment table, since BarqRaftar's own view (rider assigned,
    live status_logs, ...) is the point of this tab."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        filters = {
            k: request.query_params.get(k)
            for k in (
                "date_from", "date_to", "page", "limit", "status",
                "tracking_number", "reference_id", "customer_name",
                "paid_at_from", "paid_at_to",
            )
        }
        # One search box on the Shipments tab: try it as a tracking number
        # first, then as our own order number (BarqRaftar's reference_id).
        search = (request.query_params.get("search") or "").strip()
        try:
            if search:
                data = client.list_orders(
                    connection.api_key, connection.api_secret, **{**filters, "tracking_number": search},
                )
                if not client._rows(data):
                    data = client.list_orders(
                        connection.api_key, connection.api_secret,
                        **{**filters, "reference_id": search.lstrip("#")},
                    )
            else:
                data = client.list_orders(connection.api_key, connection.api_secret, **filters)
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        # {"status": "success", "orders": [...], "total", "from", "to"} -
        # confirmed live; passed through as-is.
        return Response(data if isinstance(data, dict) else {"orders": data})


class BarqRaftarShipmentTrackView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        tracking_number = request.query_params.get("tracking_number")
        reference_id = request.query_params.get("reference_id")
        if not tracking_number and not reference_id:
            return Response(
                {"detail": "tracking_number or reference_id is required"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        try:
            order = client.get_order(
                connection.api_key, connection.api_secret,
                tracking_number=tracking_number, reference_id=reference_id,
            )
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        if not order:
            return Response(
                {"detail": "BarqRaftar has no order with that tracking number/reference."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        return Response(order)


class BarqRaftarPaymentsView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            data = client.list_payments(
                connection.api_key, connection.api_secret,
                date_from=request.query_params.get("date_from"),
                date_to=request.query_params.get("date_to"),
                page=request.query_params.get("page", 1),
                limit=request.query_params.get("limit", 10),
            )
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        return Response(data if isinstance(data, dict) else {"data": data})


class BarqRaftarPaymentDetailView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request, payment_id):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            data = client.payment_detail(connection.api_key, connection.api_secret, payment_id)
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
        return Response(data if isinstance(data, dict) else {"data": data})


class BarqRaftarShipmentActionView(APIView):
    """POST {action, tracking_number, ...}. action is one of:
    - "awaiting_pickup": bulk_change_status -> awaiting_pickup (only legal
      from BarqRaftar's own "pending" status)
    - "cancel": routes through oms.services.cancel_order so the matching
      OMS order (if any) and its stock follow, not just the BarqRaftar side
    - "shipper_advice": re_attempt / hold / return for a parcel BarqRaftar
      reports as returned by the consignee
    """

    permission_classes = [IsOrgAdmin]

    def post(self, request):
        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)

        action_name = request.data.get("action")
        tracking_number = (request.data.get("tracking_number") or "").strip()
        if not tracking_number:
            return Response({"detail": "tracking_number is required"}, status=http_status.HTTP_400_BAD_REQUEST)

        if action_name == "awaiting_pickup":
            try:
                result = client.change_status(
                    connection.api_key, connection.api_secret,
                    [{"tracking_number": tracking_number, "status": "awaiting_pickup"}],
                )
            except BarqRaftarAPIError as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
            # Refusals are HTTP 200 with orders_result[0].success=false.
            refused = client.first_result_error(result)
            if refused:
                return Response({"detail": f"BarqRaftar: {refused}"}, status=http_status.HTTP_400_BAD_REQUEST)
            return Response(result if isinstance(result, dict) else {"result": result})

        if action_name == "cancel":
            from .models import BarqRaftarShipment
            from oms import services as oms_services

            shipment = BarqRaftarShipment.objects.filter(
                organization_id=request.organization_id, tracking_number=tracking_number, is_active=True,
            ).select_related("order").first()
            if not shipment:
                return Response(
                    {"detail": "No local order found for this tracking number - "
                               "cancel it from the BarqRaftar portal directly."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            try:
                oms_services.cancel_order(
                    shipment.order, reason=request.data.get("reason", ""), actor_user_id=request.user_id,
                )
            except (BarqRaftarBookingError, oms_services.InvalidTransition) as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
            return Response({"success": True})

        if action_name == "shipper_advice":
            try:
                result = client.add_shipper_advice(
                    connection.api_key, connection.api_secret,
                    tracking_number=tracking_number,
                    shipper_advice=request.data.get("shipper_advice"),
                    re_attempt_reason=request.data.get("re_attempt_reason"),
                    re_attempt_reason_text=request.data.get("re_attempt_reason_text"),
                    new_address=request.data.get("new_address"),
                )
            except BarqRaftarAPIError as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)
            return Response(result if isinstance(result, dict) else {"result": result})

        return Response({"detail": f"Unknown action {action_name!r}"}, status=http_status.HTTP_400_BAD_REQUEST)


def _save_print_batch(*, organization_id, order_numbers, content, actor_user_id):
    """Same reasoning/shape as oms/views.py OrderViewSet._save_print_batch -
    kept as its own small copy here rather than imported, since that method
    is private to OrderViewSet. Best-effort: a storage hiccup must not
    block the PDF the user is actively downloading."""
    from oms.models import PrintBatch

    try:
        sorted_numbers = sorted(str(n) for n in order_numbers)
        existing = PrintBatch.all_objects.filter(
            organization_id=organization_id, kind="airway_bill", courier="barqraftar",
            order_numbers=sorted_numbers,
        ).first() if sorted_numbers else None

        if existing:
            batch = existing
            if batch.file:
                batch.file.delete(save=False)
            batch.content_type = "application/pdf"
            batch.created_by_user_id = actor_user_id
        else:
            batch = PrintBatch.all_objects.create(
                organization_id=organization_id, kind="airway_bill", courier="barqraftar",
                order_count=len(sorted_numbers), order_numbers=sorted_numbers,
                content_type="application/pdf", created_by_user_id=actor_user_id,
            )
        batch.file.save("airway_bill.pdf", ContentFile(content), save=True)
    except Exception:
        logger.exception("barqraftar: failed to save print batch")


class BarqRaftarLabelsView(APIView):
    """POST {order_ids} OR {tracking_numbers} -> one merged PDF of BarqRaftar
    labels. order_ids (OMS order UUIDs) is what the orders page/order detail
    panel send (see _lib/orderActions.js's print_barqraftar_labels);
    tracking_numbers is for the Shipments tab, whose rows come straight
    from BarqRaftar's own /orders listing and don't carry an OMS order id
    at all. BarqRaftar's own print_orders takes at most 20 tracking numbers
    per call, so this chunks and merges with pypdf (see requirements.txt)
    rather than exposing that limit to the frontend."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        from .models import BarqRaftarShipment

        order_ids = request.data.get("order_ids") or []
        requested_tracking_numbers = request.data.get("tracking_numbers") or []
        if not order_ids and not requested_tracking_numbers:
            return Response(
                {"detail": "order_ids or tracking_numbers is required"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        connection = BarqRaftarConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"detail": "BarqRaftar is not connected"}, status=http_status.HTTP_404_NOT_FOUND)

        if order_ids:
            shipments = list(
                BarqRaftarShipment.objects.filter(
                    organization_id=request.organization_id, order_id__in=order_ids,
                    is_active=True,
                ).exclude(tracking_number="").select_related("order")
            )
            order_numbers = [s.order.order_number for s in shipments]
        else:
            shipments = list(
                BarqRaftarShipment.objects.filter(
                    organization_id=request.organization_id,
                    tracking_number__in=requested_tracking_numbers,
                ).select_related("order")
            )
            order_numbers = [s.order.order_number for s in shipments]
        if not shipments:
            # A tracking number BarqRaftar's own listing shows that this
            # app never booked (e.g. imported straight on their portal)
            # has no local shipment row at all - fall back to printing by
            # tracking number directly, just without a PrintBatch record.
            if requested_tracking_numbers:
                tracking_numbers = list(requested_tracking_numbers)
                order_numbers = []
            else:
                return Response(
                    {"detail": "None of the selected orders have an active BarqRaftar shipment."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
        else:
            tracking_numbers = [s.tracking_number for s in shipments]

        try:
            from pypdf import PdfWriter
        except ImportError:
            return Response(
                {"detail": "The 'pypdf' package isn't installed on the server yet - run "
                           "`pip install pypdf` and restart the backend."},
                status=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        writer = PdfWriter()
        try:
            for start in range(0, len(tracking_numbers), 20):
                chunk = tracking_numbers[start:start + 20]
                pdf_bytes = client.print_labels(
                    connection.api_key, connection.api_secret, chunk,
                    response_type="pdf", label_format=connection.label_format,
                )
                writer.append(fileobj=io.BytesIO(pdf_bytes))
        except BarqRaftarAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)

        buffer = io.BytesIO()
        writer.write(buffer)
        merged = buffer.getvalue()

        _save_print_batch(
            organization_id=request.organization_id, order_numbers=order_numbers,
            content=merged, actor_user_id=request.user_id,
        )
        return HttpResponse(merged, content_type="application/pdf")


# --------------------------------------------------------------- Webhook --

def _verify_barqraftar_signature(raw_body, secret, header_value):
    """Kept for symmetry with Smartlane's webhook (and in case BarqRaftar
    ever does send a signature header), but BarqRaftar's own docs describe
    no such header - see barqraftar/services.py's handle_webhook_event,
    which never trusts the payload's status regardless, so this being
    unused in practice is not a security gap."""
    if not secret or not header_value:
        return False
    computed = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, header_value)


@csrf_exempt
@require_POST
def barqraftar_webhook(request, token):
    """`token` (from the URL) is the primary authentication, same shape as
    Smartlane's webhook - an unguessable per-org UUID embedded in the
    callback URL registered with BarqRaftar support (there is no self-
    service webhook API to register it through, unlike Shopify)."""
    logger.info(
        "barqraftar webhook received: token=%s bytes=%s from=%s",
        token, len(request.body or b""), get_client_ip(request) or "?",
    )
    logger.debug("barqraftar webhook raw body: %s", (request.body or b"")[:2000])

    try:
        connection = BarqRaftarConnection.all_objects.get(webhook_token=token, is_connected=True)
    except BarqRaftarConnection.DoesNotExist:
        logger.warning("barqraftar webhook REJECTED: no connected account for token %s", token)
        return JsonResponse({"detail": "Unknown or disconnected account"}, status=404)

    try:
        payload = json.loads(request.body)
    except ValueError:
        logger.warning("barqraftar webhook REJECTED for org %s: body was not JSON", connection.organization_id)
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    try:
        services.handle_webhook_event(connection, payload)
    except Exception:
        logger.exception("barqraftar webhook: handling failed for org %s", connection.organization_id)

    connection.events_received_count += 1
    connection.last_event_at = timezone.now()
    connection.save(update_fields=["events_received_count", "last_event_at"])
    return JsonResponse({"success": True})
