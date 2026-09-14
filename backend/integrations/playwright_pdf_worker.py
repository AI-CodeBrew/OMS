"""Standalone Playwright PDF renderer - run as a subprocess, never imported.

Deliberately has NO Django/channels/daphne imports. See
smartlane_client._render_pdf, which spawns this via subprocess.run(): on
Windows, once Daphne is running (added for the WebSocket live-order-update
feature), the whole process's asyncio event-loop policy has been swapped
for one that cannot spawn subprocesses at all - Daphne needs that policy
for Twisted's reactor, Playwright's sync API needs the opposite to launch
its own browser subprocess, and there is no per-thread way to have both in
one process. A freshly spawned python.exe never inherits that poisoned
policy, so running the actual browser launch here instead fixes it - but
only if this file's own import chain never pulls in anything that would
re-trigger the same reactor/policy setup in this child. Production
(Fly/Linux) never has this conflict - Linux's default loop already
supports subprocesses - so this is purely what makes local Windows dev
work; it changes nothing about how the render itself happens.

Protocol: one JSON object on stdin - {"url", "api_key", "context"}. On
success, raw PDF bytes on stdout (exit 0). On failure, a plain-text message
on stderr (exit 1) - the parent process maps specific substrings (e.g.
"Executable doesn't exist") to a friendlier error, so this deliberately
lets Playwright's own exception text through unmodified rather than
rewording it here.
"""

import json
import sys
import time


def render(url, api_key, context):
    from playwright.sync_api import sync_playwright

    started = time.monotonic()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()

            # The auth headers go on the page request ONLY, via routing,
            # rather than new_page(extra_http_headers=...) - that applies
            # them to every request the page makes, images included, and
            # an image host handed an unexpected Authorization header (S3
            # and most CDNs) rejects it outright, which is how the load
            # sheet's logo silently went missing from the PDF while the
            # rest of the page rendered. Sending "Accept: text/html" for
            # an image was the same kind of wrong. Leaving sub-resource
            # headers untouched lets the browser send what it normally
            # would, exactly like a person loading the page.
            def _auth_document_only(route, request):
                if request.resource_type == "document":
                    route.continue_(headers={
                        **request.headers,
                        "authorization": f"Bearer {api_key}",
                        "accept": "text/html",
                    })
                else:
                    route.continue_()

            page.route("**/*", _auth_document_only)

            # Whatever the page couldn't load is what's missing from the
            # PDF, so name it on stderr instead of leaving a blank spot to
            # guess at.
            page.on("requestfailed", lambda r: print(
                f"smartlane pdf {context or url}: {r.resource_type} request "
                f"failed ({r.failure or 'unknown error'}) {r.url[:200]}",
                file=sys.stderr,
            ))
            page.on("response", lambda r: r.status >= 400 and print(
                f"smartlane pdf {context or url}: {r.request.resource_type} "
                f"-> HTTP {r.status} {r.url[:200]}",
                file=sys.stderr,
            ))

            resp = page.goto(url, wait_until="networkidle", timeout=30000)
            if resp is None or not resp.ok:
                status = resp.status if resp else "no response"
                body = page.content()[:500]
                print(
                    f"smartlane pdf render {context or url} -> HTTP {status}: {body}",
                    file=sys.stderr,
                )
                raise RuntimeError(f"{context or url} failed to load (HTTP {status})")
            pdf_bytes = page.pdf(format="A4", print_background=True)
        finally:
            browser.close()

    print(
        f"smartlane pdf render {context or url} -> {len(pdf_bytes)} bytes "
        f"in {time.monotonic() - started:.2f}s",
        file=sys.stderr,
    )
    return pdf_bytes


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    try:
        pdf_bytes = render(payload["url"], payload["api_key"], payload.get("context", ""))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(pdf_bytes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
