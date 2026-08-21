import base64
import hashlib
import hmac
import json

from django.conf import settings
from django.http import JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequireModule

from . import shopify_client
from .models import ShopifyConnection
from .serializers import ShopifyConnectionSerializer
from .services import upsert_order_from_shopify


class ShopifyConnectionView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def get(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id
        ).first()
        if not connection:
            return Response({"connected": False})
        data = ShopifyConnectionSerializer(connection).data
        data["connected"] = True
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

        connection, _ = ShopifyConnection.objects.update_or_create(
            organization_id=request.organization_id,
            defaults={
                "shop_domain": shop_domain,
                "access_token": access_token,
                "webhook_secret": webhook_secret,
                "currency": shop_info.get("currency", ""),
                "is_connected": True,
            },
        )

        webhook_url = f"{settings.PUBLIC_BACKEND_URL.rstrip('/')}{reverse('shopify-order-webhook')}"
        warnings = []
        for topic in ("orders/create", "orders/updated"):
            try:
                shopify_client.register_webhook(
                    shop_domain, access_token, settings.SHOPIFY_API_VERSION, topic, webhook_url
                )
            except shopify_client.ShopifyAPIError as exc:
                warnings.append(str(exc))

        data = ShopifyConnectionSerializer(connection).data
        data["connected"] = True
        data["webhook_url"] = webhook_url
        if warnings:
            data["webhook_warnings"] = warnings
        return Response(data, status=http_status.HTTP_201_CREATED)


class ShopifySyncView(APIView):
    permission_classes = [RequireModule]
    required_module = "oms"

    def post(self, request):
        connection = ShopifyConnection.objects.filter(
            organization_id=request.organization_id, is_connected=True
        ).first()
        if not connection:
            return Response(
                {"detail": "Not connected to Shopify yet"}, status=http_status.HTTP_400_BAD_REQUEST
            )

        try:
            orders = shopify_client.fetch_recent_orders(
                connection.shop_domain,
                connection.access_token,
                settings.SHOPIFY_API_VERSION,
                limit=50,
            )
        except shopify_client.ShopifyAPIError as exc:
            return Response({"detail": str(exc)}, status=http_status.HTTP_502_BAD_GATEWAY)

        created_count = 0
        updated_count = 0
        for shopify_order in orders:
            _, created = upsert_order_from_shopify(request.organization_id, shopify_order)
            if created:
                created_count += 1
            else:
                updated_count += 1

        connection.last_synced_at = timezone.now()
        connection.save(update_fields=["last_synced_at"])

        return Response({"created": created_count, "updated": updated_count, "total_fetched": len(orders)})


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

    upsert_order_from_shopify(connection.organization_id, payload)

    connection.last_synced_at = timezone.now()
    connection.save(update_fields=["last_synced_at"])
    return JsonResponse({"success": True})
