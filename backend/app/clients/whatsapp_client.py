import os

import requests


class WhatsAppClient:
    """Abstracted WhatsApp provider. Swap implementation without touching callers."""

    def __init__(self, api_url=None, api_token=None):
        self.api_url = api_url or os.getenv("WHATSAPP_API_URL")
        self.api_token = api_token or os.getenv("WHATSAPP_API_TOKEN")

    def send_message(self, to, body, **kwargs):
        if not self.api_url or not self.api_token:
            raise RuntimeError("WhatsApp provider is not configured")
        response = requests.post(
            self.api_url,
            headers={"Authorization": f"Bearer {self.api_token}"},
            json={"to": to, "body": body, **kwargs},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
