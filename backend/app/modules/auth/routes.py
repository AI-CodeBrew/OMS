from flask import Blueprint, request

from app.constants import error_codes
from app.core.auth import require_auth
from app.core.errors import DomainError
from app.core.responses import error, success
from app.modules.auth.service import auth_service

auth_bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")


@auth_bp.route("/login", methods=["POST"])
def login():
    body = request.get_json(silent=True) or {}
    try:
        data = auth_service.login(
            email=body.get("email"),
            password=body.get("password"),
        )
        return success(data)
    except DomainError as exc:
        return error(exc.message, exc.code, exc.status)
    except Exception:
        return error("Login failed", error_codes.INTERNAL_ERROR, 500)


@auth_bp.route("/me", methods=["GET"])
@require_auth
def me():
    try:
        data = auth_service.me(request.user_id)
        return success({"user": data})
    except DomainError as exc:
        return error(exc.message, exc.code, exc.status)
    except Exception:
        return error("Failed to load profile", error_codes.INTERNAL_ERROR, 500)
