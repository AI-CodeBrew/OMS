from rest_framework import status, viewsets
from rest_framework.response import Response

from core.permissions import RequireModule

from . import services
from .models import Order
from .serializers import OrderSerializer


class OrderViewSet(viewsets.ModelViewSet):
    serializer_class = OrderSerializer
    permission_classes = [RequireModule]
    required_module = "oms"

    def get_queryset(self):
        # Order.objects already scopes to the caller's organization via
        # TenantScopedModel's manager; filtering explicitly here too keeps
        # the query readable without relying on that being remembered.
        return Order.objects.filter(
            organization_id=self.request.organization_id
        ).prefetch_related("items")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = services.create_order(
            organization_id=request.organization_id,
            order_number=serializer.validated_data["order_number"],
            customer_name=serializer.validated_data["customer_name"],
            customer_phone=serializer.validated_data.get("customer_phone", ""),
            items=serializer.validated_data["items"],
        )
        output = self.get_serializer(order)
        return Response(output.data, status=status.HTTP_201_CREATED)
