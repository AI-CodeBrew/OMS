import io
import logging
import threading
from datetime import date, timedelta

from django.core.files.base import ContentFile
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsOrgAdmin, RequireModule
from core.rbac import write_audit_log

from . import client, services
from .exceptions import PostExAPIError, PostExBookingError
from .models import PostExConnection, PostExShipment, PostExSyncJob
from .serializers import PostExConnectionSerializer, PostExStatusSerializer, PostExSyncJobSerializer

logger = logging.getLogger(__name__)

# Same reasoning as BarqRaftar's STALE_JOB_SECONDS - a job saves progress at
# least once per chunk, so one untouched this long has no live thread left.
STALE_JOB_SECONDS = 180

ORDER_TYPES = ("Normal", "Reversed", "Replacement")

# get-all-order is slow over long ranges (5 weeks timed out at 60s, single
# days answer in ~2s - confirmed live), so the Shipments tab's range is
# capped and fetched in week-sized windows.
MAX_LIST_DAYS = 31
LIST_WINDOW_DAYS = 7


def _connection(request):
    return PostExConnection.objects.filter(organization_id=request.organization_id, is_connected=True).first()


def _not_connected():
    return Response({"detail": "PostEx is not connected"}, status=http_status.HTTP_404_NOT_FOUND)


def _bad_gateway(exc):
    return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)


def _connection_payload(connection, request):
    data = PostExConnectionSerializer(connection, context={"request": request}).data
    data["connected"] = True
    return data


class PostExConnectionView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return Response({"connected": False})
        return Response(_connection_payload(connection, request))

    def post(self, request):
        api_token = (request.data.get("api_token") or "").strip()
        if not api_token:
            return Response({"detail": "api_token is required"}, status=http_status.HTTP_400_BAD_REQUEST)

        # Cheapest authenticated call PostEx offers (~1KB) - validates the
        # token before anything is saved, and lets a single pickup address
        # be made active straight away.
        try:
            addresses = client.list_pickup_addresses(api_token)
        except PostExAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        connection, _ = PostExConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={"api_token": api_token, "is_connected": True},
        )
        pickup_capable = [a for a in addresses if "pickup" in str(a.get("addressType") or "").lower()
                          or "default" in str(a.get("addressType") or "").lower()]
        if not connection.pickup_address_code and len(pickup_capable) == 1:
            only = pickup_capable[0]
            connection.pickup_address_code = str(only.get("addressCode") or "")
            connection.pickup_address_label = str(only.get("contactPersonName") or only.get("address") or "")
            connection.pickup_city_name = str(only.get("cityName") or "")
            connection.save(update_fields=[
                "pickup_address_code", "pickup_address_label", "pickup_city_name", "updated_at",
            ])

        write_audit_log(
            organization_id=request.organization_id,
            action="integrations.postex.connect",
            summary="Connected PostEx",
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
            entity_type="postex_connection",
            entity_id=str(connection.id),
            metadata={},
        )
        return Response(_connection_payload(connection, request), status=http_status.HTTP_201_CREATED)

    def patch(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()

        data = request.data
        fields = []
        if "default_order_type" in data:
            order_type = str(data.get("default_order_type") or "")
            if order_type not in ORDER_TYPES:
                return Response(
                    {"detail": f"default_order_type must be one of {', '.join(ORDER_TYPES)}"},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            connection.default_order_type = order_type
            fields.append("default_order_type")
        if "default_notes" in data:
            connection.default_notes = str(data.get("default_notes") or "").strip()[:255]
            fields.append("default_notes")
        if "pickup_address_code" in data:
            connection.pickup_address_code = str(data.get("pickup_address_code") or "").strip()
            connection.pickup_address_label = str(data.get("pickup_address_label") or "").strip()[:255]
            connection.pickup_city_name = str(data.get("pickup_city_name") or "").strip()[:150]
            fields += ["pickup_address_code", "pickup_address_label", "pickup_city_name"]
        if "city_aliases" in data and isinstance(data.get("city_aliases"), dict):
            connection.city_aliases = {
                services._normalize_city_name(k): str(v).strip()
                for k, v in data["city_aliases"].items()
                if services._normalize_city_name(k) and str(v).strip()
            }
            fields.append("city_aliases")

        if fields:
            connection.save(update_fields=fields + ["updated_at"])
        return Response(_connection_payload(connection, request))

    def delete(self, request):
        connection = PostExConnection.objects.filter(organization_id=request.organization_id).first()
        if connection:
            connection.is_connected = False
            connection.save(update_fields=["is_connected", "updated_at"])
            write_audit_log(
                organization_id=request.organization_id,
                action="integrations.postex.disconnect",
                summary="Disconnected PostEx",
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                entity_type="postex_connection",
                entity_id=str(connection.id),
                metadata={},
            )
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class PostExStatusView(APIView):
    """Read by the orders page (any oms staff) to decide whether to show the
    PostEx actions at all."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = _connection(request)
        connected = bool(connection)
        ready_to_book = bool(connected and connection.pickup_address_code)
        return Response(PostExStatusSerializer({"connected": connected, "ready_to_book": ready_to_book}).data)


def _mark_stale_job_failed(job):
    job.status = "failed"
    job.error_message = (
        f"Sync stalled after {job.checked_count} shipment(s) (likely a server restart) - click Sync to try again."
    )
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at", "updated_at"])


class PostExSyncView(APIView):
    """Kicks off a background poll and returns immediately; GET for progress."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        job = PostExSyncJob.objects.filter(organization_id=request.organization_id).first()
        if not job:
            return Response({"status": "idle"})
        if job.status in ("pending", "running"):
            if (timezone.now() - job.updated_at).total_seconds() > STALE_JOB_SECONDS:
                _mark_stale_job_failed(job)
        return Response(PostExSyncJobSerializer(job).data)

    def delete(self, request):
        job = PostExSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if not job:
            return Response({"detail": "No sync in progress"}, status=http_status.HTTP_400_BAD_REQUEST)
        job.cancel_requested = True
        job.status = "cancelled"
        job.finished_at = timezone.now()
        job.save(update_fields=["cancel_requested", "status", "finished_at", "updated_at"])
        return Response(PostExSyncJobSerializer(job).data)

    def post(self, request):
        if not _connection(request):
            return _not_connected()

        existing = PostExSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if existing:
            if (timezone.now() - existing.updated_at).total_seconds() <= STALE_JOB_SECONDS:
                return Response({"detail": "A sync is already in progress"}, status=http_status.HTTP_409_CONFLICT)
            _mark_stale_job_failed(existing)

        job = PostExSyncJob.objects.create(organization_id=request.organization_id)
        threading.Thread(
            target=services.run_postex_sync, args=(request.organization_id, job.id), daemon=True,
        ).start()
        return Response(PostExSyncJobSerializer(job).data, status=http_status.HTTP_202_ACCEPTED)


class PostExCityListView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()
        try:
            cities = services.get_cities(connection, force_refresh=request.query_params.get("refresh") == "1")
        except PostExAPIError as exc:
            return _bad_gateway(exc)
        return Response({"cities": cities, "aliases": connection.city_aliases})


class PostExPickupAddressesView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()
        try:
            addresses = client.list_pickup_addresses(connection.api_token)
        except PostExAPIError as exc:
            return _bad_gateway(exc)
        return Response({"addresses": addresses, "active_code": connection.pickup_address_code})

    def post(self, request):
        """Adds a pickup address on PostEx. PostEx's create answers without
        the new addressCode, so the list is re-read and the new code found
        by diffing - then optionally made active."""
        connection = _connection(request)
        if not connection:
            return _not_connected()
        data = request.data
        required = ("address", "city_name", "contact_person_name", "phone1")
        missing = [k for k in required if not str(data.get(k) or "").strip()]
        if missing:
            return Response(
                {"detail": f"Missing: {', '.join(missing)}"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        try:
            before = {str(a.get("addressCode")) for a in client.list_pickup_addresses(connection.api_token)}
            client.create_pickup_address(
                connection.api_token,
                address=str(data["address"]).strip(),
                city_name=str(data["city_name"]).strip(),
                contact_person_name=str(data["contact_person_name"]).strip(),
                phone1=str(data["phone1"]).strip(),
                phone2=str(data.get("phone2") or data["phone1"]).strip(),
                phone3=str(data.get("phone3") or "").strip(),
                warehouse_manager_name=str(data.get("warehouse_manager_name") or "").strip(),
                address_type_id=2,
            )
            addresses = client.list_pickup_addresses(connection.api_token)
        except PostExAPIError as exc:
            return _bad_gateway(exc)

        new_rows = [a for a in addresses if str(a.get("addressCode")) not in before]
        if data.get("set_default") and len(new_rows) == 1:
            row = new_rows[0]
            connection.pickup_address_code = str(row.get("addressCode") or "")
            connection.pickup_address_label = str(row.get("contactPersonName") or row.get("address") or "")[:255]
            connection.pickup_city_name = str(row.get("cityName") or "")[:150]
            connection.save(update_fields=[
                "pickup_address_code", "pickup_address_label", "pickup_city_name", "updated_at",
            ])
        return Response({"addresses": addresses, "active_code": connection.pickup_address_code})


def _list_window(start, end, status_id, token):
    rows = []
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=LIST_WINDOW_DAYS - 1), end)
        rows += client.list_orders(
            token, start_date=cursor.isoformat(), end_date=window_end.isoformat(), status_id=status_id,
        )
        cursor = window_end + timedelta(days=1)
    return rows


class PostExShipmentsView(APIView):
    """PostEx's own order listing (get-all-order) for a date range, or one
    order by tracking number / our order number. Rows booked through OMS get
    oms_order_id/oms_order_number so the tab can offer cancel for them."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()

        search = (request.query_params.get("search") or "").strip()
        try:
            if search:
                rows = self._search(connection, request, search)
            else:
                try:
                    start = date.fromisoformat(request.query_params.get("date_from") or "")
                    end = date.fromisoformat(request.query_params.get("date_to") or "")
                except ValueError:
                    end = timezone.localdate()
                    start = end - timedelta(days=6)
                if end < start:
                    start, end = end, start
                if (end - start).days + 1 > MAX_LIST_DAYS:
                    return Response(
                        {"detail": f"Pick a range of {MAX_LIST_DAYS} days or less - PostEx is slow over longer ranges."},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )
                status_id = request.query_params.get("status_id") or 0
                rows = _list_window(start, end, int(status_id) if str(status_id).isdigit() else 0,
                                    connection.api_token)
        except PostExAPIError as exc:
            return _bad_gateway(exc)

        rows = [r for r in rows if isinstance(r, dict)]
        rows.sort(key=lambda r: str(r.get("transactionDate") or ""), reverse=True)

        tracking_numbers = [str(r.get("trackingNumber") or "") for r in rows if r.get("trackingNumber")]
        local = {
            s.tracking_number: s
            for s in PostExShipment.objects.filter(
                organization_id=request.organization_id, tracking_number__in=tracking_numbers, is_active=True,
            ).select_related("order")
        }
        for row in rows:
            shipment = local.get(str(row.get("trackingNumber") or ""))
            row["oms_order_id"] = str(shipment.order_id) if shipment else None
            row["oms_order_number"] = shipment.order.order_number if shipment else None

        if rows and not connection.merchant_name and rows[0].get("merchantName"):
            connection.merchant_name = str(rows[0]["merchantName"])[:255]
            connection.save(update_fields=["merchant_name", "updated_at"])

        return Response({"orders": rows, "total": len(rows)})

    def _search(self, connection, request, search):
        row = client.track_order(connection.api_token, search)
        if row:
            return [row]
        # Not a PostEx tracking number - try it as our own order number.
        shipment = PostExShipment.objects.filter(
            organization_id=request.organization_id, reference=search.lstrip("#"),
        ).exclude(tracking_number="").first()
        if shipment:
            row = client.track_order(connection.api_token, shipment.tracking_number)
            return [row] if row else []
        return []


class PostExShipmentTrackView(APIView):
    """One parcel's full picture for the Track modal: the order with its
    status history, payment/settlement status, and shipper-advice remarks."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()
        tracking_number = (request.query_params.get("tracking_number") or "").strip()
        if not tracking_number:
            return Response({"detail": "tracking_number is required"}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            order = client.track_order(connection.api_token, tracking_number)
            if not order:
                return Response(
                    {"detail": "PostEx has no order with that tracking number."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            payment = client.payment_status(connection.api_token, tracking_number)
            advice = client.get_shipper_advice(connection.api_token, tracking_number)
        except PostExAPIError as exc:
            return _bad_gateway(exc)
        return Response({"order": order, "payment": payment, "advice": advice})


class PostExShipmentActionView(APIView):
    """POST {action, tracking_number, ...}:
    - "cancel": routes through oms.services.cancel_order so the OMS order and
      its stock follow, not just the PostEx side
    - "shipper_advice": {status_id: 1 (return) | 2 (re-attempt), remarks} for
      an attempted / under-review parcel"""

    permission_classes = [IsOrgAdmin]

    def post(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()

        action_name = request.data.get("action")
        tracking_number = (request.data.get("tracking_number") or "").strip()
        if not tracking_number:
            return Response({"detail": "tracking_number is required"}, status=http_status.HTTP_400_BAD_REQUEST)

        if action_name == "cancel":
            from oms import services as oms_services

            shipment = PostExShipment.objects.filter(
                organization_id=request.organization_id, tracking_number=tracking_number, is_active=True,
            ).select_related("order").first()
            if not shipment:
                return Response(
                    {"detail": "This parcel wasn't booked from OMS - cancel it from the PostEx portal."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            try:
                oms_services.cancel_order(
                    shipment.order, reason=request.data.get("reason", ""), actor_user_id=request.user_id,
                )
            except (PostExBookingError, oms_services.InvalidTransition) as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
            return Response({"success": True})

        if action_name == "shipper_advice":
            status_id = request.data.get("status_id")
            if str(status_id) not in (str(client.SHIPPER_ADVICE_RETURN), str(client.SHIPPER_ADVICE_REATTEMPT)):
                return Response(
                    {"detail": "status_id must be 1 (return) or 2 (re-attempt)"},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            remarks = str(request.data.get("remarks") or "").strip()
            if not remarks:
                return Response({"detail": "remarks are required"}, status=http_status.HTTP_400_BAD_REQUEST)
            try:
                result = client.save_shipper_advice(
                    connection.api_token, tracking_number, status_id=int(status_id), remarks=remarks[:500],
                )
            except PostExAPIError as exc:
                return _bad_gateway(exc)
            return Response(result if isinstance(result, dict) else {"result": result})

        return Response({"detail": f"Unknown action {action_name!r}"}, status=http_status.HTTP_400_BAD_REQUEST)


def _save_print_batch(*, organization_id, order_numbers, content, actor_user_id, kind):
    """Same shape as BarqRaftar's own copy (oms/views.py's is private to
    OrderViewSet). Best-effort: a storage hiccup must not block the PDF the
    user is downloading."""
    from oms.models import PrintBatch

    try:
        sorted_numbers = sorted(str(n) for n in order_numbers)
        existing = PrintBatch.all_objects.filter(
            organization_id=organization_id, kind=kind, courier="postex", order_numbers=sorted_numbers,
        ).first() if sorted_numbers else None
        if existing:
            batch = existing
            if batch.file:
                batch.file.delete(save=False)
            batch.content_type = "application/pdf"
            batch.created_by_user_id = actor_user_id
        else:
            batch = PrintBatch.all_objects.create(
                organization_id=organization_id, kind=kind, courier="postex",
                order_count=len(sorted_numbers), order_numbers=sorted_numbers,
                content_type="application/pdf", created_by_user_id=actor_user_id,
            )
        batch.file.save(f"postex_{kind}.pdf", ContentFile(content), save=True)
    except Exception:
        logger.exception("postex: failed to save print batch")


class PostExAirwayBillView(APIView):
    """POST {order_ids} or {tracking_numbers} -> one merged PDF of PostEx
    airway bills. PostEx prints at most 10 per call, so this chunks and
    merges with pypdf rather than exposing that limit."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        order_ids = request.data.get("order_ids") or []
        requested = [str(t).strip() for t in (request.data.get("tracking_numbers") or []) if str(t).strip()]
        if not order_ids and not requested:
            return Response(
                {"detail": "order_ids or tracking_numbers is required"}, status=http_status.HTTP_400_BAD_REQUEST
            )
        connection = _connection(request)
        if not connection:
            return _not_connected()

        if order_ids:
            shipments = services.active_shipments(request.organization_id, order_ids)
            if not shipments:
                return Response(
                    {"detail": "None of the selected orders have an active PostEx shipment."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            tracking_numbers = [s.tracking_number for s in shipments]
            order_numbers = [s.order.order_number for s in shipments]
        else:
            # Shipments tab rows come from PostEx's own listing and may never
            # have been booked from OMS - print by tracking number directly.
            tracking_numbers = requested
            order_numbers = list(
                PostExShipment.objects.filter(
                    organization_id=request.organization_id, tracking_number__in=requested,
                ).values_list("order__order_number", flat=True)
            )

        from pypdf import PdfWriter

        writer = PdfWriter()
        try:
            for start in range(0, len(tracking_numbers), client.AIRWAY_BILL_MAX):
                chunk = tracking_numbers[start:start + client.AIRWAY_BILL_MAX]
                writer.append(fileobj=io.BytesIO(client.airway_bill(connection.api_token, chunk)))
        except PostExAPIError as exc:
            return _bad_gateway(exc)

        buffer = io.BytesIO()
        writer.write(buffer)
        merged = buffer.getvalue()
        _save_print_batch(
            organization_id=request.organization_id, order_numbers=order_numbers,
            content=merged, actor_user_id=request.user_id, kind="airway_bill",
        )
        return HttpResponse(merged, content_type="application/pdf")


class PostExLoadSheetView(APIView):
    """POST {order_ids} -> PostEx's own load sheet PDF for the selected
    orders' active shipments. This is the hand-over step on PostEx's side
    (their status goes Unbooked -> Booked and the rider collects them)."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        order_ids = request.data.get("order_ids") or []
        if not order_ids:
            return Response({"detail": "order_ids is required"}, status=http_status.HTTP_400_BAD_REQUEST)
        connection = _connection(request)
        if not connection:
            return _not_connected()

        shipments = services.active_shipments(request.organization_id, order_ids)
        if not shipments:
            return Response(
                {"detail": "None of the selected orders have an active PostEx shipment."},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        try:
            pdf_bytes = client.generate_load_sheet(
                connection.api_token, [s.tracking_number for s in shipments],
            )
        except PostExAPIError as exc:
            return _bad_gateway(exc)

        services.mark_load_sheet_generated(shipments)
        _save_print_batch(
            organization_id=request.organization_id,
            order_numbers=[s.order.order_number for s in shipments],
            content=pdf_bytes, actor_user_id=request.user_id, kind="loadsheet",
        )
        return HttpResponse(pdf_bytes, content_type="application/pdf")
