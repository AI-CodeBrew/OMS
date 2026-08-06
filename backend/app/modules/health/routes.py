import os
from datetime import datetime, timezone

from flask import Blueprint, request

from app.core.auth import require_auth
from app.core.responses import success

health_bp = Blueprint("health", __name__, url_prefix="/api/v1")


@health_bp.route("/health", methods=["GET"])
def health():
    """Public liveness probe — no auth."""
    return success(
        {
            "status": "ok",
            "service": "oms-api",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "env": os.getenv("FLASK_ENV", "production"),
        }
    )


@health_bp.route("/health/protected", methods=["GET"])
@require_auth
def health_protected():
    """Authenticated health check — validates JWT + tenant context end-to-end."""
    return success(
        {
            "status": "ok",
            "service": "oms-api",
            "authenticated": True,
            "user_id": request.user_id,
            "tenant_id": request.tenant_id,
            "role": request.user.get("role"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
