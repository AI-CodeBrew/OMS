"""Cron-style Celery beat tasks (stock alerts, confirmation retries)."""

from app.workers.celery_app import celery_app


@celery_app.task(name="scheduled.check_low_stock")
def check_low_stock():
    # Implemented when WMS module lands
    return {"ok": True}


@celery_app.task(name="scheduled.retry_failed_confirmations")
def retry_failed_confirmations():
    # Implemented when confirmation module lands
    return {"ok": True}
