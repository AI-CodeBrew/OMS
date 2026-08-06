import os

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

from app.core.errors import DomainError
from app.core.responses import error
from app.constants import error_codes


def create_app():
    load_dotenv()

    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")

    origins = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    CORS(app, resources={r"/api/*": {"origins": origins}}, supports_credentials=True)

    _register_blueprints(app)
    _register_error_handlers(app)

    return app


def _register_blueprints(app):
    from app.modules.auth import auth_bp
    from app.modules.health import health_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)

    # Remaining modules registered as they are implemented:
    # tenants, orders, confirmation, ops, wms, returns, finance, integrations


def _register_error_handlers(app):
    @app.errorhandler(DomainError)
    def handle_domain_error(exc):
        return error(exc.message, exc.code, exc.status)

    @app.errorhandler(404)
    def handle_not_found(_exc):
        return error("Not found", error_codes.NOT_FOUND, 404)

    @app.errorhandler(500)
    def handle_internal(_exc):
        return error("Internal server error", error_codes.INTERNAL_ERROR, 500)
