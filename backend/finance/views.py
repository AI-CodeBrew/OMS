from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.permissions import IsOrgAdmin

from .models import BankDetails

IBAN_LENGTH = 24  # Pakistani IBAN: "PK" + 2 check digits + 20 alphanumerics


def _serialize(details):
    if not details:
        return None
    return {
        "account_title": details.account_title,
        "bank_name": details.bank_name,
        "account_number": details.account_number,
        "iban": details.iban,
        "branch_code": details.branch_code,
        "updated_at": details.updated_at.isoformat(),
    }


@api_view(["GET", "PUT"])
@permission_classes([IsOrgAdmin])
def bank_details(request):
    """One row per org - where FynkTech remits this store's COD. GET
    returns null until the store has saved one; PUT always upserts (there's
    only ever the one row)."""
    organization_id = request.organization_id
    existing = BankDetails.objects.filter(organization_id=organization_id).first()

    if request.method == "GET":
        return Response({"success": True, "bank_details": _serialize(existing)})

    body = request.data or {}
    account_title = (body.get("account_title") or "").strip()
    bank_name = (body.get("bank_name") or "").strip()
    account_number = (body.get("account_number") or "").strip()
    iban = (body.get("iban") or "").strip().upper().replace(" ", "")
    branch_code = (body.get("branch_code") or "").strip()

    if not account_title or not bank_name:
        return Response(
            {"success": False, "error": "Account title and bank name are required"}, status=400
        )
    if not account_number and not iban:
        return Response(
            {"success": False, "error": "Enter an account number or an IBAN"}, status=400
        )
    if iban and (len(iban) != IBAN_LENGTH or not iban.startswith("PK")):
        return Response(
            {"success": False, "error": "IBAN should be PK followed by 22 characters"}, status=400
        )

    details, _ = BankDetails.objects.update_or_create(
        organization_id=organization_id,
        defaults={
            "account_title": account_title,
            "bank_name": bank_name,
            "account_number": account_number,
            "iban": iban,
            "branch_code": branch_code,
            "updated_by": request.user_id,
        },
    )
    return Response({"success": True, "bank_details": _serialize(details)})
