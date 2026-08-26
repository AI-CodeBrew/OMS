import base64
import hashlib
import hmac
import json
import threading

from django.conf import settings
from django.http import JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from oms.models import Order
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.context import current_organization_id
from core.permissions import RequireModule
from oms import services as oms_services

from . import shopify_client
from . import services
from .models import ShopifyConnection, ShopifySyncJob, SmartlaneConnection
from .serializers import ShopifyConnectionSerializer, ShopifySyncJobSerializer, SmartlaneConnectionSerializer
from .services import upsert_order_from_shopify


class ShopifyConnectionView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"connected": False})
        data = ShopifyConnectionSerializer(connection).data
        data["connected"] = True
        data["synced_orders_count"] = Order.objects.filter(
            organization_id=request.organization_id, shopify_order_id__isnull=False
        ).count()
        return Response(data)

    def post(self, request):
        shop_domain = (request.data.get("shop_domain") or "").strip()
        access_token = (request.data.get("access_token") or "").strip()
        webhook_secret = (request.data.get("webhook_secret") or "").strip()
        if not (shop_domain and access_token and webhook_secret):
            return Response(
                {"detail": "shop_domain, access_token and webhook_secret are all required"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            shop_info = shopify_client.fetch_shop_info(
                shop_domain, access_token, settings.SHOPIFY_API_VERSION
            )
        except shopify_client.ShopifyAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)

        webhook_url = f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{reverse('shopify-order-webhook')}"
        webhook_ids = []
        warnings = []
        for topic in ("orders/create", "orders/updated"):
            try:
                webhook = shopify_client.register_webhook(
                    shop_domain, access_token, settings.SHOPIFY_API_VERSION, topic, webhook_url
                )
                webhook_ids.append(webhook["id"])
            except shopify_client.ShopifyAPIError as exc:
                warnings.append(str(exc))

        connection, _ = ShopifyConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={
                "shop_domain": shop_domain,
                "shop_name": shop_info.get("name", ""),
                "access_token": access_token,
                "webhook_secret": webhook_secret,
                "currency": shop_info.get("currency", ""),
                "is_connected": True,
                "webhooks_active": bool(webhook_ids) and not warnings,
                "webhook_ids": webhook_ids,
            },
        )

        data = ShopifyConnectionSerializer(connection).data
        data["connected"] = True
        data["webhook_url"] = webhook_url
        if warnings:
            data["webhook_warnings"] = warnings
        return Response(data, status=http_status.HTTP_201_CREATED)

    def patch(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response(
                {"detail": "Not connected to Shopify yet"}, status=http_status.HTTP_400_BAD_REQUEST
            )
        if "auto_sync_orders" in request.data:
            connection.auto_sync_orders = bool(request.data["auto_sync_orders"])
            connection.save(update_fields=["auto_sync_orders"])

        if "webhooks_active" in request.data:
            want_active = bool(request.data["webhooks_active"])
            if want_active and not connection.webhooks_active:
                webhook_url = f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{reverse('shopify-order-webhook')}"
                ids = []
                warnings = []
                for topic in ("orders/create", "orders/updated"):
                    try:
                        webhook = shopify_client.register_webhook(
                            connection.shop_domain,
                            connection.access_token,
                            settings.SHOPIFY_API_VERSION,
                            topic,
                            webhook_url,
                        )
                        ids.append(webhook["id"])
                    except shopify_client.ShopifyAPIError as exc:
                        warnings.append(str(exc))
                connection.webhook_ids = ids
                connection.webhooks_active = bool(ids) and not warnings
                connection.save(update_fields=["webhook_ids", "webhooks_active"])
                if warnings:
                    return Response(
                        {**ShopifyConnectionSerializer(connection).data, "webhook_warnings": warnings}
                    )
            elif not want_active and connection.webhooks_active:
                for webhook_id in connection.webhook_ids:
                    try:
                        shopify_client.unregister_webhook(
                            connection.shop_domain,
                            connection.access_token,
                            settings.SHOPIFY_API_VERSION,
                            webhook_id,
                        )
                    except shopify_client.ShopifyAPIError:
                        pass  # best-effort - still turn it off locally either way
                connection.webhook_ids = []
                connection.webhooks_active = False
                connection.save(update_fields=["webhook_ids", "webhooks_active"])

        return Response(ShopifyConnectionSerializer(connection).data)

    def delete(self, request):
        # Soft-disconnect - keeps credentials/history so reconnecting is
        # instant, rather than deleting the row outright.
        connection = ShopifyConnection.objects.filter(organization_id=request.organization_id).first()
        if connection:
            connection.is_connected = False
            connection.save(update_fields=["is_connected"])
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class ShopifyTestConnectionView(APIView):
    """Checks a shop_domain/access_token pair against Shopify's API without
    saving anything - lets the UI validate credentials before committing to
    Connect/Update Credentials."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        shop_domain = (request.data.get("shop_domain") or "").strip()
        access_token = (request.data.get("access_token") or "").strip()
        if not (shop_domain and access_token):
            return Response(
                {"detail": "shop_domain and access_token are required"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        try:
            shop_info = shopify_client.fetch_shop_info(
                shop_domain, access_token, settings.SHOPIFY_API_VERSION
            )
        except shopify_client.ShopifyAPIError as exc:
            return Response({"success": False, "detail": str(exc)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(
            {"success": True, "shop_name": shop_info.get("name", ""), "currency": shop_info.get("currency", "")}
        )


class SmartlaneConnectionView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = SmartlaneConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response({"connected": False})
        data = SmartlaneConnectionSerializer(connection, context={"request": request}).data
        data["connected"] = True
        return Response(data)

    def post(self, request):
        api_key = (request.data.get("api_key") or "").strip()
        webhook_secret = (request.data.get("webhook_secret") or "").strip()
        if not webhook_secret:
            return Response(
                {"detail": "webhook_secret is required"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        connection, _ = SmartlaneConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={
                "api_key": api_key,
                "webhook_secret": webhook_secret,
                "is_connected": True,
                "webhooks_active": True,
            },
        )
        data = SmartlaneConnectionSerializer(connection, context={"request": request}).data
        data["connected"] = True
        return Response(data, status=http_status.HTTP_201_CREATED)

    def delete(self, request):
        connection = SmartlaneConnection.objects.filter(organization_id=request.organization_id).first()
        if connection:
            connection.is_connected = False
            connection.webhooks_active = False
            connection.save(update_fields=["is_connected", "webhooks_active"])
        return Response(status=http_status.HTTP_204_NO_CONTENT)


def _verify_smartlane_signature(raw_body, secret, header_value):
    if not secret or not header_value:
        return False
    computed = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, header_value)


# Best-guess event contract - no official Smartlane webhook spec was
# available while building this integration. Adjust the payload field
# names and status values here once real Smartlane webhook payloads are
# available to test against; the shape below mirrors common courier
# webhook conventions (order reference + tracking number + a status enum).
_SMARTLANE_DISPATCH_STATUSES = {"picked", "dispatched", "in_transit", "out_for_delivery"}


@csrf_exempt
@require_POST
def smartlane_shipment_webhook(request, token):
    """No Supabase JWT here - Smartlane authenticates via HMAC signature
    instead, same idea as the Shopify webhook. `token` (from the URL,
    see SmartlaneConnectionSerializer.get_webhook_url) identifies which
    org's webhook_secret to verify against, since Smartlane has no
    per-request account/domain header the way Shopify does."""
    try:
        connection = SmartlaneConnection.all_objects.get(webhook_token=token, is_connected=True)
    except SmartlaneConnection.DoesNotExist:
        return JsonResponse({"detail": "Unknown or disconnected account"}, status=404)

    signature = request.META.get("HTTP_X_SMARTLANE_SIGNATURE")
    if not _verify_smartlane_signature(request.body, connection.webhook_secret, signature):
        return JsonResponse({"detail": "Invalid signature"}, status=401)

    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    order_number = (payload.get("order_number") or "").strip()
    tracking_number = (payload.get("tracking_number") or "").strip()
    smartlane_status = (payload.get("status") or "").strip().lower()

    if order_number:
        # This request carries no Supabase JWT, so TenantMiddleware never
        # set the tenant context - the oms.services transition helpers
        # below rely on it (via Order.objects' tenant-scoped manager), so
        # it has to be set explicitly here, scoped to just this block.
        context_token = current_organization_id.set(connection.organization_id)
        try:
            order = oms_services.Order.objects.filter(order_number=order_number).first()
            if order:
                try:
                    if smartlane_status == "delivered":
                        oms_services.mark_delivered(order)
                    elif smartlane_status == "returned":
                        oms_services.scan_return(
                            organization_id=connection.organization_id,
                            order_number=order.order_number,
                            reason="Reported returned by Smartlane",
                        )
                    elif smartlane_status == "cancelled":
                        oms_services.cancel_order(order, reason="Cancelled by Smartlane")
                    elif smartlane_status in _SMARTLANE_DISPATCH_STATUSES:
                        oms_services.dispatch_order(order, tracking_number=tracking_number)
                except oms_services.InvalidTransition:
                    # Order's already past/before this stage locally - the
                    # event is stale or arrived out of order - safe to skip
                    # rather than error, Smartlane shouldn't retry forever.
                    pass
        finally:
            current_organization_id.reset(context_token)

    connection.events_received_count += 1
    connection.last_event_at = timezone.now()
    connection.save(update_fields=["events_received_count", "last_event_at"])

    return JsonResponse({"success": True})


# A job saves progress at least once per page (worst case ~250 orders *
# ~1s each), so anything "running"/"pending" that hasn't been touched in
# this long has no live thread behind it anymore - almost always a
# runserver auto-reload (or crash) that killed the background thread
# mid-sync, per the exact scenario this app hit in practice.
STALE_JOB_SECONDS = 180


def _mark_stale_job_failed(job):
    job.status = "failed"
    job.error_message = (
        f"Sync stalled after {job.total_fetched} orders (likely a server restart) - "
        "click Sync to resume from where it left off."
    )
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at"])


class ShopifyGapView(APIView):
    """Finds history windows where Shopify holds more orders than we do.

    Runs synchronously: it's one API call per calendar month (plus two
    setup calls), so a couple of years of history is well under the
    request timeout - unlike the sync itself, which is thousands of
    per-order database writes and has to be backgrounded.
    """

    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response(
                {"detail": "Not connected to Shopify yet"}, status=http_status.HTTP_400_BAD_REQUEST
            )
        try:
            return Response(services.find_order_gaps(request.organization_id))
        except shopify_client.ShopifyAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)


class ShopifySyncView(APIView):
    """Kicks off an order sync as a background thread and returns
    immediately - a full historical pull can be tens of thousands of
    orders (verified against this exact store: 8,874), which takes far
    too long to run inside one HTTP request/response cycle. Poll GET for
    progress. See integrations/services.py's run_shopify_sync for the
    actual work and why it's structured as a plain thread rather than
    Celery (no broker available in this environment yet)."""

    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        job = ShopifySyncJob.objects.filter(organization_id=request.organization_id).first()
        if not job:
            return Response({"status": "idle"})
        if job.status in ("pending", "running"):
            age = (timezone.now() - job.updated_at).total_seconds()
            if age > STALE_JOB_SECONDS:
                _mark_stale_job_failed(job)
        return Response(ShopifySyncJobSerializer(job).data)

    def delete(self, request):
        # Flips status to "cancelled" immediately - covers both a genuinely
        # live thread (which cooperatively checks cancel_requested and
        # stops itself after its current page, see services.run_shopify_sync)
        # and a job whose thread already died (e.g. a runserver auto-reload
        # mid-sync), which would otherwise stay stuck at "running" forever
        # with nothing left able to update it.
        job = ShopifySyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        if not job:
            return Response({"detail": "No sync in progress"}, status=http_status.HTTP_400_BAD_REQUEST)
        job.cancel_requested = True
        job.status = "cancelled"
        job.finished_at = timezone.now()
        job.save(update_fields=["cancel_requested", "status", "finished_at"])
        return Response(ShopifySyncJobSerializer(job).data)

    def post(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response(
                {"detail": "Not connected to Shopify yet"}, status=http_status.HTTP_400_BAD_REQUEST
            )
        if not connection.auto_sync_orders:
            return Response(
                {"detail": "Order syncing is turned off for this connection"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        existing = ShopifySyncJob.objects.filter(
            organization_id=request.organization_id, status__in=["pending", "running"]
        ).first()
        resume_from = None
        if existing:
            age = (timezone.now() - existing.updated_at).total_seconds()
            if age <= STALE_JOB_SECONDS:
                return Response(
                    {"detail": "A sync is already in progress"}, status=http_status.HTTP_409_CONFLICT
                )
            # Stale (its thread is dead, e.g. a runserver restart) - clear
            # it out of the way and, unless the user explicitly asked to
            # start over, pick up from wherever it left off rather than
            # re-fetching everything from page 1.
            resume_from = existing
            _mark_stale_job_failed(existing)
        else:
            # No pending/running job right now - but it may have already
            # been marked stale-failed by an earlier GET poll (the
            # frontend checks status every couple seconds while showing
            # "Syncing...", well before the user manually clicks Sync
            # again). Without this, that job would be invisible to the
            # check above and this would silently fall through to an
            # incremental sync below - meaning every retry after an
            # interruption quietly gives up on ever finishing the full
            # historical pull instead of resuming it.
            last_job = (
                ShopifySyncJob.objects.filter(organization_id=request.organization_id)
                .order_by("-created_at")
                .first()
            )
            if (
                last_job
                and last_job.status in ("failed", "cancelled")
                and last_job.mode in ("full", "custom")
                and last_job.resume_cursor
            ):
                resume_from = last_job

        date_from = request.data.get("date_from")
        date_to = request.data.get("date_to")
        force_full = bool(request.data.get("full"))
        # Gap backfill: several disconnected windows, fetched one after
        # another in this single job (see services._iter_windows).
        ranges = request.data.get("ranges") or []
        if ranges and not isinstance(ranges, list):
            return Response(
                {"detail": "ranges must be a list of {from, to} objects"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if ranges:
            mode = "backfill"
            created_at_min = created_at_max = None
            date_from = ranges[0].get("from")
            date_to = ranges[-1].get("to")
        elif date_from or date_to:
            mode = "custom"
            created_at_min = date_from or None
            created_at_max = date_to or None
        elif force_full:
            mode = "full"
            created_at_min = created_at_max = None
        elif resume_from and resume_from.resume_cursor:
            # Continue the stalled run in place - same mode/range, just
            # picking up right after the last order it actually wrote.
            mode = resume_from.mode
            created_at_min = resume_from.resume_cursor.isoformat()
            created_at_max = resume_from.range_to.isoformat() if resume_from.range_to else None
            date_from = resume_from.range_from
            date_to = resume_from.range_to
        elif connection.last_synced_at:
            # Every sync after the first only asks Shopify for orders
            # created since the last one, whether it's this same button
            # clicked again or the "Sync New Orders" label - both hit this
            # branch automatically once last_synced_at is set.
            mode = "incremental"
            created_at_min = connection.last_synced_at.isoformat()
            created_at_max = None
        else:
            mode = "full"
            created_at_min = created_at_max = None

        job = ShopifySyncJob.objects.create(
            organization_id=request.organization_id,
            mode=mode,
            range_from=date_from or None,
            range_to=date_to or None,
            ranges=[{"from": r.get("from"), "to": r.get("to")} for r in ranges],
        )
        thread = threading.Thread(
            target=services.run_shopify_sync,
            args=(request.organization_id, job.id),
            kwargs={
                "connection_id": connection.id,
                "created_at_min": created_at_min,
                "created_at_max": created_at_max,
            },
            daemon=True,
        )
        thread.start()

        return Response(ShopifySyncJobSerializer(job).data, status=http_status.HTTP_202_ACCEPTED)


def _verify_shopify_hmac(raw_body, secret, header_value):
    if not secret or not header_value:
        return False
    computed = base64.b64encode(
        hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(computed, header_value)


@csrf_exempt
@require_POST
def shopify_order_webhook(request):
    """No Supabase JWT here - Shopify authenticates via HMAC signature
    instead. The shop domain header tells us which org's webhook_secret
    to verify against."""
    shop_domain = request.META.get("HTTP_X_SHOPIFY_SHOP_DOMAIN")
    hmac_header = request.META.get("HTTP_X_SHOPIFY_HMAC_SHA256")
    if not shop_domain:
        return JsonResponse({"detail": "Missing shop domain header"}, status=400)

    try:
        connection = ShopifyConnection.all_objects.get(shop_domain=shop_domain, is_connected=True)
    except ShopifyConnection.DoesNotExist:
        return JsonResponse({"detail": "Unknown or disconnected shop"}, status=404)

    if not _verify_shopify_hmac(request.body, connection.webhook_secret, hmac_header):
        return JsonResponse({"detail": "Invalid signature"}, status=401)

    try:
        payload = json.loads(request.body)
    except ValueError:
        return JsonResponse({"detail": "Invalid JSON"}, status=400)

    if connection.auto_sync_orders:
        upsert_order_from_shopify(
            connection.organization_id,
            payload,
            shop_label=connection.shop_name or connection.shop_domain,
        )
        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at"])

    return JsonResponse({"success": True})
