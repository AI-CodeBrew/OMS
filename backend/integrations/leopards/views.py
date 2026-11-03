import hmac
import io
import json
import logging
import threading
from datetime import date, timedelta

from django.core.files.base import ContentFile
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.context import tenant_context
from core.middleware import get_client_ip
from core.permissions import IsOrgAdmin, RequireModule
from core.platform_service import is_platform_organization
from core.rbac import write_audit_log

from . import client, services
from .exceptions import LeopardsAPIError, LeopardsBookingError
from .models import WEBHOOK_HEADER_KEY, LeopardsConnection, LeopardsShipment, LeopardsSyncJob, new_webhook_secret
from .serializers import LeopardsConnectionSerializer, LeopardsStatusSerializer, LeopardsSyncJobSerializer

logger = logging.getLogger(__name__)

# Same reasoning as PostEx's STALE_JOB_SECONDS - a job saves progress at
# least once per chunk, so one untouched this long has no live thread left.
STALE_JOB_SECONDS = 180

# The PrintBatch.courier key for Leopards' own documents. NOT "leopards":
# that is what Smartlane's load sheets for parcels it routed to Leopards are
# saved under (oms/views.py), and the two must stay apart.
PRINT_BATCH_COURIER = "leopards-direct"

# The Shipments tab lists OMS's own LeopardsShipment rows (Leopards has no
# "list everything" call), capped like the other couriers' tabs.
MAX_LIST_DAYS = 92
MAX_LIST_ROWS = 500


def _connection(request):
    return LeopardsConnection.objects.filter(organization_id=request.organization_id, is_connected=True).first()


def _not_connected():
    return Response({"detail": "Leopards is not connected"}, status=http_status.HTTP_404_NOT_FOUND)


def _bad_gateway(exc):
    return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)


def _connection_payload(connection, request):
    data = LeopardsConnectionSerializer(connection, context={"request": request}).data
    data["connected"] = True
    return data


class LeopardsConnectionView(APIView):
    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return Response({"connected": False})
        return Response(_connection_payload(connection, request))

    def post(self, request):
        api_key = (request.data.get("api_key") or "").strip()
        api_password = (request.data.get("api_password") or "").strip()
        if not api_key or not api_password:
            return Response(
                {"detail": "api_key and api_password are required"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        # Cheapest authenticated call Leopards offers - validates the
        # credentials before anything is saved, and its answer is the city
        # list the connection caches straight away.
        try:
            cities = client.get_all_cities(LeopardsConnection(api_key=api_key, api_password=api_password))
        except LeopardsAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        connection, _ = LeopardsConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={"api_key": api_key, "api_password": api_password, "is_connected": True},
        )
        services.cache_cities(connection, cities)

        write_audit_log(
            organization_id=request.organization_id,
            action="integrations.leopards.connect",
            summary="Connected Leopards",
            actor_user_id=request.user_id,
            actor_email=getattr(request, "auth_email", "") or "",
            entity_type="leopards_connection",
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
        if "default_weight_grams" in data:
            try:
                grams = int(data.get("default_weight_grams"))
            except (TypeError, ValueError):
                grams = 0
            if not 1 <= grams <= 100000:
                return Response(
                    {"detail": "default_weight_grams must be between 1 and 100000"},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            connection.default_weight_grams = grams
            fields.append("default_weight_grams")
        if "default_shipment_type" in data:
            connection.default_shipment_type = str(data.get("default_shipment_type") or "").strip()[:50]
            fields.append("default_shipment_type")
        if "default_notes" in data:
            connection.default_notes = str(data.get("default_notes") or "").strip()[:255]
            fields.append("default_notes")
        if "load_sheet_courier_name" in data:
            name = str(data.get("load_sheet_courier_name") or "").strip()[:100]
            if not name:
                return Response(
                    {"detail": "load_sheet_courier_name can't be empty"}, status=http_status.HTTP_400_BAD_REQUEST
                )
            connection.load_sheet_courier_name = name
            fields.append("load_sheet_courier_name")
        if "load_sheet_courier_code" in data:
            code = str(data.get("load_sheet_courier_code") or "").strip()[:30]
            if not code:
                return Response(
                    {"detail": "load_sheet_courier_code can't be empty"}, status=http_status.HTTP_400_BAD_REQUEST
                )
            connection.load_sheet_courier_code = code
            fields.append("load_sheet_courier_code")
        if "origin_city_id" in data:
            raw = data.get("origin_city_id")
            if raw in (None, "", 0, "0"):
                connection.origin_city_id = None
                connection.origin_city_name = ""
            else:
                try:
                    city_id = int(raw)
                except (TypeError, ValueError):
                    return Response({"detail": "Pick an origin city from the list."},
                                    status=http_status.HTTP_400_BAD_REQUEST)
                city = next((c for c in (connection.cities_cache or []) if c.get("id") == city_id), None)
                if city is None or not city.get("origin", True):
                    return Response({"detail": "Leopards doesn't ship from that city."},
                                    status=http_status.HTTP_400_BAD_REQUEST)
                connection.origin_city_id = city_id
                connection.origin_city_name = city["name"][:150]
            fields += ["origin_city_id", "origin_city_name"]
        if "city_aliases" in data and isinstance(data.get("city_aliases"), dict):
            connection.city_aliases = {
                services._normalize_city_name(k): str(v).strip()
                for k, v in data["city_aliases"].items()
                if services._normalize_city_name(k) and str(v).strip()
            }
            fields.append("city_aliases")

        if data.get("regenerate_webhook_secret"):
            # The old value stops working at once - what's registered with
            # Leopards must be updated with the new one (the page says so
            # before asking).
            connection.webhook_secret = new_webhook_secret()
            fields.append("webhook_secret")
            write_audit_log(
                organization_id=request.organization_id,
                action="integrations.leopards.webhook_secret_regenerated",
                summary="Regenerated the Leopards webhook secret",
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                entity_type="leopards_connection",
                entity_id=str(connection.id),
                metadata={},
            )

        if fields:
            connection.save(update_fields=fields + ["updated_at"])
        return Response(_connection_payload(connection, request))

    def delete(self, request):
        connection = LeopardsConnection.objects.filter(organization_id=request.organization_id).first()
        if connection:
            connection.is_connected = False
            connection.save(update_fields=["is_connected", "updated_at"])
            write_audit_log(
                organization_id=request.organization_id,
                action="integrations.leopards.disconnect",
                summary="Disconnected Leopards",
                actor_user_id=request.user_id,
                actor_email=getattr(request, "auth_email", "") or "",
                entity_type="leopards_connection",
                entity_id=str(connection.id),
                metadata={},
            )
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class LeopardsStatusView(APIView):
    """Read by the orders page (any oms staff) to decide whether to show the
    Leopards actions at all."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        # In the Dispatch Hub this is FynkTech's own account (every Hub
        # booking goes through it) - see services.connection_for_request.
        connection = services.connection_for_request(request)
        connected = bool(connection)
        # A store booking its own orders through FynkTech's account (OMS
        # Courier) - not a Dispatch Hub thing, where `connected` already is
        # FynkTech's account.
        oms_connected = bool(
            not getattr(request, "organization_ids", None)
            and request.organization_id
            and services.store_shipper(request.organization_id)
            and services.platform_connection()
        )
        return Response(
            LeopardsStatusSerializer(
                {"connected": connected, "ready_to_book": connected, "oms_connected": oms_connected}
            ).data
        )


def _mark_stale_job_failed(job):
    job.status = "failed"
    job.error_message = (
        f"Sync stalled after {job.checked_count} shipment(s) (likely a server restart) - click Sync to try again."
    )
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at", "updated_at"])


class LeopardsSyncView(APIView):
    """Kicks off a background poll and returns immediately; GET for progress."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        job = LeopardsSyncJob.objects.filter(organization_id=request.organization_id).first()
        if not job:
            return Response({"status": "idle"})
        if job.status in ("pending", "running"):
            if (timezone.now() - job.updated_at).total_seconds() > STALE_JOB_SECONDS:
                _mark_stale_job_failed(job)
        return Response(LeopardsSyncJobSerializer(job).data)

    def delete(self, request):
        job = LeopardsSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if not job:
            return Response({"detail": "No sync in progress"}, status=http_status.HTTP_400_BAD_REQUEST)
        job.cancel_requested = True
        job.status = "cancelled"
        job.finished_at = timezone.now()
        job.save(update_fields=["cancel_requested", "status", "finished_at", "updated_at"])
        return Response(LeopardsSyncJobSerializer(job).data)

    def post(self, request):
        if not _connection(request):
            return _not_connected()

        existing = LeopardsSyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if existing:
            if (timezone.now() - existing.updated_at).total_seconds() <= STALE_JOB_SECONDS:
                return Response({"detail": "A sync is already in progress"}, status=http_status.HTTP_409_CONFLICT)
            _mark_stale_job_failed(existing)

        job = LeopardsSyncJob.objects.create(organization_id=request.organization_id)
        threading.Thread(
            target=services.run_leopards_sync, args=(request.organization_id, job.id), daemon=True,
        ).start()
        return Response(LeopardsSyncJobSerializer(job).data, status=http_status.HTTP_202_ACCEPTED)


class LeopardsCityListView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()
        try:
            cities = services.get_cities(connection, force_refresh=request.query_params.get("refresh") == "1")
        except LeopardsAPIError as exc:
            return _bad_gateway(exc)
        return Response({"cities": cities, "aliases": connection.city_aliases})


def _local_shipments(request):
    """The shipments the Shipments tab lists: the store's own, or - for
    FynkTech's account (OMS Couriers tab) - every Hub booking."""
    if is_platform_organization(request.organization_id):
        return LeopardsShipment.all_objects.exclude(order__platform_reference="")
    return LeopardsShipment.objects.filter(organization_id=request.organization_id, order__platform_reference="")


class LeopardsShipmentsView(APIView):
    """The parcels booked through OMS with Leopards, newest first - for a
    date range (by booking date) or one parcel by CN / order number."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()

        qs = _local_shipments(request).select_related("order")
        search = (request.query_params.get("search") or "").strip()
        if search:
            term = search.lstrip("#")
            qs = qs.filter(tracking_number=search) | qs.filter(reference__iexact=term) | qs.filter(
                order__order_number__in=[search, f"#{term}", term]
            )
        else:
            try:
                start = date.fromisoformat(request.query_params.get("date_from") or "")
                end = date.fromisoformat(request.query_params.get("date_to") or "")
            except ValueError:
                end = timezone.localdate()
                start = end - timedelta(days=29)
            if end < start:
                start, end = end, start
            if (end - start).days + 1 > MAX_LIST_DAYS:
                return Response(
                    {"detail": f"Pick a range of {MAX_LIST_DAYS} days or less."},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(booked_at__date__gte=start, booked_at__date__lte=end)

        rows = []
        for shipment in qs.order_by("-booked_at")[:MAX_LIST_ROWS]:
            order = shipment.order
            rows.append({
                "id": str(shipment.id),
                "oms_order_id": str(order.id),
                "oms_order_number": order.order_number,
                "oms_order_status": order.status,
                "customer_name": order.customer_name,
                "city": order.city,
                "reference": shipment.reference,
                "tracking_number": shipment.tracking_number,
                "slip_link": shipment.slip_link,
                "status_label": shipment.status_label,
                "is_active": shipment.is_active,
                "booked_at": shipment.booked_at,
                "load_sheet_at": shipment.load_sheet_at,
                "cancelled_at": shipment.cancelled_at,
                "cod_amount": services._cod_amount(order),
            })
        return Response({"orders": rows, "total": len(rows)})


class LeopardsShipmentTrackView(APIView):
    """One parcel's full picture for the Track modal: Leopards' tracking row
    with its history, payment status, and shipper-advice requests."""

    permission_classes = [IsOrgAdmin]

    def get(self, request):
        connection = _connection(request)
        if not connection:
            return _not_connected()
        tracking_number = (request.query_params.get("tracking_number") or "").strip()
        if not tracking_number:
            return Response({"detail": "tracking_number is required"}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            rows = client.track_packets(connection, [tracking_number])
        except LeopardsAPIError as exc:
            return _bad_gateway(exc)
        order = rows.get(tracking_number)
        if not order:
            return Response(
                {"detail": "Leopards has no packet with that CN number."}, status=http_status.HTTP_404_NOT_FOUND,
            )
        # Payment and advice are extras: a refusal there must not hide the
        # tracking itself.
        try:
            payment = client.payment_details(connection, [tracking_number])
        except LeopardsAPIError:
            payment = []
        try:
            advice = client.shipper_advice_list(connection, tracking_number)
        except LeopardsAPIError:
            advice = []
        return Response({"order": order, "payment": payment, "advice": advice})


class LeopardsShipmentActionView(APIView):
    """POST {action, tracking_number, ...}:
    - "cancel": routes through oms.services.cancel_order so the OMS order and
      its stock follow, not just the Leopards side
    - "shipper_advice": {status: "RA" (re-attempt) | "RT" (return), remarks}
      for a parcel Leopards is waiting on the shipper's word for"""

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

            if is_platform_organization(request.organization_id):
                # FynkTech's account (OMS Couriers tab) - its parcels are
                # the Hub stores' orders.
                shipment = LeopardsShipment.all_objects.filter(
                    tracking_number=tracking_number, is_active=True,
                ).exclude(order__platform_reference="").select_related("order").first()
            else:
                shipment = LeopardsShipment.objects.filter(
                    organization_id=request.organization_id, tracking_number=tracking_number, is_active=True,
                ).select_related("order").first()
            if not shipment:
                return Response(
                    {"detail": "This parcel wasn't booked from OMS - cancel it from the Leopards portal."},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            try:
                with tenant_context(shipment.organization_id):
                    oms_services.cancel_order(
                        shipment.order, reason=request.data.get("reason", ""), actor_user_id=request.user_id,
                    )
            except (LeopardsBookingError, oms_services.InvalidTransition) as exc:
                return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
            return Response({"success": True})

        if action_name == "shipper_advice":
            advice_status = str(request.data.get("status") or "").strip().upper()
            if advice_status not in ("RA", "RT"):
                return Response(
                    {"detail": "status must be RA (re-attempt) or RT (return)"},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            remarks = str(request.data.get("remarks") or "").strip()
            if not remarks:
                return Response({"detail": "remarks are required"}, status=http_status.HTTP_400_BAD_REQUEST)
            try:
                rows = client.shipper_advice_list(connection, tracking_number)
                advice = next((r for r in rows if isinstance(r, dict) and r.get("id")), None)
                if advice is None:
                    return Response(
                        {"detail": "Leopards has no shipper-advice request for this parcel - it only asks "
                                   "for advice on parcels it couldn't deliver."},
                        status=http_status.HTTP_404_NOT_FOUND,
                    )
                result = client.update_shipper_advice(
                    connection, advice_id=advice["id"], cn_number=tracking_number,
                    status=advice_status, remarks=remarks[:500],
                )
            except LeopardsAPIError as exc:
                return _bad_gateway(exc)
            return Response({"success": True, "data": result.get("data") if isinstance(result, dict) else None})

        return Response({"detail": f"Unknown action {action_name!r}"}, status=http_status.HTTP_400_BAD_REQUEST)


def _save_print_batch(*, organization_id, order_numbers, content, actor_user_id, kind):
    """Same shape as PostEx's own copy (oms/views.py's is private to
    OrderViewSet). Best-effort: a storage hiccup must not block the PDF the
    user is downloading."""
    from oms.models import PrintBatch

    try:
        sorted_numbers = sorted(str(n) for n in order_numbers)
        existing = PrintBatch.all_objects.filter(
            organization_id=organization_id, kind=kind, courier=PRINT_BATCH_COURIER, order_numbers=sorted_numbers,
        ).first() if sorted_numbers else None
        if existing:
            batch = existing
            if batch.file:
                batch.file.delete(save=False)
            batch.content_type = "application/pdf"
            batch.created_by_user_id = actor_user_id
        else:
            batch = PrintBatch.all_objects.create(
                organization_id=organization_id, kind=kind, courier=PRINT_BATCH_COURIER,
                order_count=len(sorted_numbers), order_numbers=sorted_numbers,
                content_type="application/pdf", created_by_user_id=actor_user_id,
            )
        batch.file.save(f"leopards_{kind}.pdf", ContentFile(content), save=True)
    except Exception:
        logger.exception("leopards: failed to save print batch")


def _shipments_by_account(order_ids):
    """The selected orders' active shipments, grouped by (store, booking
    account) - one store's own account, or FynkTech's for a Dispatch Hub
    booking (services.connection_for_order). Leopards only prints an
    account's own parcels, and each store keeps its own print history, so
    every group is rendered on its own. TenantManager scopes the query to
    the store - or to every Hub store while operating the Hub. Returns
    (groups, error_response); groups is [(organization_id, connection,
    shipments)] in first-seen order."""
    shipments = list(
        LeopardsShipment.objects.filter(order_id__in=order_ids, is_active=True)
        .exclude(tracking_number="").select_related("order").order_by("booked_at", "id")
    )
    if not shipments:
        return None, Response(
            {"detail": "None of the selected orders have an active Leopards shipment."},
            status=http_status.HTTP_404_NOT_FOUND,
        )
    connections = {}
    groups = {}
    for shipment in shipments:
        via_platform = bool(shipment.order.platform_reference)
        key = (str(shipment.organization_id), via_platform)
        if key not in connections:
            connections[key] = services.connection_for_order(shipment.order)
            if connections[key] is None:
                if via_platform:
                    return None, Response(
                        {"detail": "FynkTech's Leopards account isn't connected (super admin's OMS Couriers tab)."},
                        status=http_status.HTTP_404_NOT_FOUND,
                    )
                return None, _not_connected()
        groups.setdefault(key, []).append(shipment)
    return [(key[0], connections[key], group) for key, group in groups.items()], None


def _merge_pdfs(pdf_byte_list):
    if len(pdf_byte_list) == 1:
        return pdf_byte_list[0]
    from pypdf import PdfWriter

    writer = PdfWriter()
    for pdf_bytes in pdf_byte_list:
        writer.append(fileobj=io.BytesIO(pdf_bytes))
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _is_pdf(content, content_type):
    return "pdf" in (content_type or "") or (content or b"").startswith(b"%PDF")


class LeopardsAirwayBillView(APIView):
    """POST {order_ids} -> one merged PDF of Leopards airway bills (slips).

    Leopards gives each booking a slip_link ("copy this URL in a browser to
    get the slip") rather than a print call, so every saved link is fetched
    and the PDFs merged. If a link answers with something that isn't a PDF
    (a web page), no PDF can be made from it here: the answer is JSON
    {"slip_links": [...]} and the page opens them instead."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        order_ids = request.data.get("order_ids") or []
        if not order_ids:
            return Response({"detail": "order_ids is required"}, status=http_status.HTTP_400_BAD_REQUEST)

        groups, error = _shipments_by_account(order_ids)
        if error:
            return error

        pdf_parts = []
        links = []
        all_pdf = True
        for organization_id, _connection_for_group, shipments in groups:
            group_pdfs, group_numbers = [], []
            for shipment in shipments:
                if not shipment.slip_link:
                    return Response(
                        {"detail": f"Order {shipment.order.order_number} has no Leopards slip link saved."},
                        status=http_status.HTTP_404_NOT_FOUND,
                    )
                links.append(shipment.slip_link)
                try:
                    content, content_type = client.fetch_slip(shipment.slip_link)
                except LeopardsAPIError as exc:
                    return _bad_gateway(exc)
                if _is_pdf(content, content_type):
                    group_pdfs.append(content)
                    group_numbers.append(shipment.order.order_number)
                else:
                    all_pdf = False
            if group_pdfs:
                merged = _merge_pdfs(group_pdfs)
                _save_print_batch(
                    organization_id=organization_id, order_numbers=group_numbers,
                    content=merged, actor_user_id=request.user_id, kind="airway_bill",
                )
                pdf_parts.append(merged)

        if all_pdf and pdf_parts:
            return HttpResponse(_merge_pdfs(pdf_parts), content_type="application/pdf")
        return JsonResponse({"slip_links": links})


class LeopardsLoadSheetView(APIView):
    """POST {order_ids} -> Leopards' own load sheet PDF for the selected
    orders' active shipments. This is the hand-over step on Leopards' side:
    generateLoadSheet makes the sheet (once per parcel - the id is kept on
    the shipment), downloadLoadSheet returns its PDF, and unlike PostEx's it
    can be downloaded again by id whenever needed."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        from oms import services as oms_services

        order_ids = request.data.get("order_ids") or []
        if not order_ids:
            return Response({"detail": "order_ids is required"}, status=http_status.HTTP_400_BAD_REQUEST)

        groups, error = _shipments_by_account(order_ids)
        if error:
            return error
        pdf_parts = []
        for organization_id, connection, shipments in groups:
            try:
                # Sheets already made are downloaded again by their id.
                for sheet_id in dict.fromkeys(s.load_sheet_id for s in shipments if s.load_sheet_id):
                    pdf_parts.append(client.download_load_sheet_pdf(connection, sheet_id))

                fresh = [s for s in shipments if not s.load_sheet_id]
                if fresh:
                    sheet_id = client.generate_load_sheet(
                        connection, [s.tracking_number for s in fresh],
                        courier_name=connection.load_sheet_courier_name,
                        courier_code=connection.load_sheet_courier_code,
                    )
                    pdf_bytes = client.download_load_sheet_pdf(connection, sheet_id)
                    services.mark_load_sheet_generated(fresh, sheet_id)
                    _save_print_batch(
                        organization_id=organization_id,
                        order_numbers=[s.order.order_number for s in fresh],
                        content=pdf_bytes, actor_user_id=request.user_id, kind="loadsheet",
                    )
                    pdf_parts.append(pdf_bytes)
            except LeopardsAPIError as exc:
                return _bad_gateway(exc)

            # Every one of them is on a load sheet now - handed over, so out
            # of Ready to Print and into Awaiting Dispatched.
            oms_services.mark_orders_handed_over(
                [s.order for s in shipments], actor_user_id=request.user_id, note="Leopards load sheet",
            )
        return HttpResponse(_merge_pdfs(pdf_parts), content_type="application/pdf")


# --------------------------------------------------------------- Webhook --

def _push_response(status_code, errors=()):
    """Leopards' Push API contract: HTTP 202 and [{"status": 1, "errors":
    []}] on success; 401 unauthorized / 400 bad request with [{"status": 0,
    "errors": [...]}]."""
    return JsonResponse(
        [{"status": 0 if errors else 1, "errors": list(errors)}], safe=False, status=status_code,
    )


@csrf_exempt
@require_http_methods(["GET", "POST", "PUT"])
def leopards_webhook(request, token):
    """Leopards' Push API callback. Public by necessity - Leopards can't log
    in - so two checks stand in for auth: `token` (an unguessable per-org
    UUID in the URL) finds the account, and the WEBHOOK_HEADER_KEY header
    must carry that account's webhook_secret (registered with Leopards as the
    "custom request header"). The body is the documented
    {"data": [{cn_number, status, receiver_name, reason, activity_date}]}
    (see services.handle_webhook_event).

    GET just answers 200 for a known URL, in case Leopards (or the merchant)
    checks it; it reveals nothing and changes nothing."""
    logger.info(
        "leopards webhook %s: token=%s bytes=%s from=%s",
        request.method, token, len(request.body or b""), get_client_ip(request) or "?",
    )

    connection = LeopardsConnection.all_objects.filter(webhook_token=token, is_connected=True).first()
    if not connection:
        logger.warning("leopards webhook REJECTED: no connected account for token %s", token)
        return _push_response(404, ["Unknown or disconnected account"])

    if request.method == "GET":
        return JsonResponse({"success": True})

    supplied = request.headers.get(WEBHOOK_HEADER_KEY) or ""
    if not supplied or not hmac.compare_digest(supplied.encode(), connection.webhook_secret.encode()):
        reason = (
            f"Call rejected: the {WEBHOOK_HEADER_KEY} header was missing."
            if not supplied
            else f"Call rejected: the {WEBHOOK_HEADER_KEY} header value didn't match."
        )
        logger.warning("leopards webhook REJECTED for org %s: %s", connection.organization_id, reason)
        services.record_webhook_rejected(connection, reason)
        return _push_response(401, ["Invalid webhook secret"])

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        logger.warning("leopards webhook REJECTED for org %s: body was not JSON", connection.organization_id)
        services.record_webhook_rejected(connection, "Call rejected: the body wasn't JSON.")
        return _push_response(400, ["Invalid JSON"])
    logger.debug("leopards webhook body for org %s: %s", connection.organization_id, (request.body or b"")[:2000])

    try:
        updated = services.handle_webhook_event(connection, payload)
        logger.info("leopards webhook for org %s: %s order(s) updated", connection.organization_id, updated)
    except Exception:
        logger.exception("leopards webhook: handling failed for org %s", connection.organization_id)

    services.record_webhook_received(connection, payload)
    return _push_response(202)
