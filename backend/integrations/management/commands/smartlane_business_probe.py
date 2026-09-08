"""One-off diagnostic for Smartlane's new "Business API" (gcp.smartlane.dev),
a separate integration from the existing smartlane_client.py (which talks
to the older smartapi.pk consignment API - see SMARTLANE_API_BASE_URL).

Their "Business API Draft 1.0" doc describes the token endpoint only in
prose ("{base url}/business/portal ... put client id and secret along
with the machine's ip address to get a JWT token") with no example
request/response body, unlike every other endpoint in the doc. This
command tries several plausible field names for the business code in one
run instead of us guessing one curl at a time, and prints the raw
response for each so whichever one actually works is obvious immediately.

Usage (from backend/, with the venv active):
    python manage.py smartlane_business_probe

Or override the test credentials Smartlane gave (defaults below are the
TEST-only values from their onboarding email - fine to keep here since
they're explicitly not production secrets):
    python manage.py smartlane_business_probe --ip 39.34.46.61
"""

import json

import requests
from django.core.management.base import BaseCommand

PORTAL_URL = "https://gcp.smartlane.dev/business/portal"

DEFAULT_BUSINESS_CODE = "bs178852549812"
DEFAULT_CLIENT_ID = "c97a3638626137749def381d1238ba6b55c42052"
DEFAULT_CLIENT_SECRET = "cc4cacdca275fbca2aac44e16acfc912ed3dfc67"

# Every *other* endpoint in Smartlane's doc uses {businessCode} in the URL
# path, never a body field - the token step is the one place that's
# ambiguous, so these are the field-name shapes worth trying in the body.
CANDIDATE_FIELD_NAMES = [
    "businessCode",
    "business_code",
    "business_id",
    "businessId",
    "business",
    "code",
]


class Command(BaseCommand):
    help = "Probe Smartlane's Business API portal endpoint to find the JWT token request shape."

    def add_arguments(self, parser):
        parser.add_argument("--business-code", default=DEFAULT_BUSINESS_CODE)
        parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID)
        parser.add_argument("--client-secret", default=DEFAULT_CLIENT_SECRET)
        parser.add_argument(
            "--ip", required=True, help="Your machine/server's public IP (see: curl ifconfig.me)"
        )

    def handle(self, *args, **options):
        headers = {
            # Smartlane is a Laravel app - our other integration
            # (smartlane_client.py) learned the hard way that skipping an
            # explicit JSON Accept header can make it answer with an HTML
            # redirect instead of a clean JSON error. Sending both up
            # front avoids chasing that same red herring here.
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        for field_name in CANDIDATE_FIELD_NAMES:
            body = {
                field_name: options["business_code"],
                "client_id": options["client_id"],
                "client_secret": options["client_secret"],
                "ip": options["ip"],
            }
            self.stdout.write(self.style.WARNING(f"\n--- trying body field '{field_name}' ---"))
            self.stdout.write(json.dumps(body, indent=2))

            try:
                response = requests.post(PORTAL_URL, json=body, headers=headers, timeout=15)
            except requests.RequestException as exc:
                self.stderr.write(self.style.ERROR(f"request failed: {exc}"))
                continue

            self.stdout.write(f"HTTP {response.status_code}")
            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                try:
                    parsed = response.json()
                except ValueError:
                    parsed = None
                if parsed is not None:
                    self.stdout.write(json.dumps(parsed, indent=2))
                    looks_successful = response.status_code < 300 and (
                        "token" in json.dumps(parsed).lower()
                    )
                    if looks_successful:
                        self.stdout.write(
                            self.style.SUCCESS(
                                f"\n*** '{field_name}' looks correct - JWT token above ***"
                            )
                        )
                        return
                    continue
            # Non-JSON (likely the HTML login redirect) - show a hint, not
            # the full page, and keep trying the rest.
            self.stdout.write(self.style.ERROR(f"non-JSON response ({content_type}) - route/shape mismatch"))

        self.stdout.write(
            self.style.WARNING(
                "\nNone of the candidate field names returned a token. Paste the JSON error "
                "bodies above back to Claude - the exact wording (e.g. which field it names) "
                "usually narrows down the real one."
            )
        )
