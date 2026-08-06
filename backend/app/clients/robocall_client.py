import os

import requests


class RobocallClient:
    """Abstracted robocall provider. Never call from request cycle — use Celery."""

    def __init__(self, api_url=None, api_token=None):
        self.api_url = api_url or os.getenv("ROBOCALL_API_URL")
        self.api_token = api_token or os.getenv("ROBOCALL_API_TOKEN")

    def place_call(self, to, script_id=None, metadata=None):
        if not self.api_url or not self.api_token:
            raise RuntimeError("Robocall provider is not configured")
        response = requests.post(
            self.api_url,
            headers={"Authorization": f"Bearer {self.api_token}"},
            json={
                "to": to,
                "script_id": script_id,
                "metadata": metadata or {},
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
