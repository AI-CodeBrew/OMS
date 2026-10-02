"""Standalone HTML -> PDF renderer for BarqRaftar documents (our own Goods
Load Sheet) - run as a subprocess, never imported.

Same reason as integrations/playwright_pdf_worker.py (Smartlane's) for
being a separate process: under Daphne on Windows the whole process's
asyncio event-loop policy can't spawn subprocesses, which Playwright's
browser launch needs, and a freshly spawned python.exe doesn't inherit
that. Kept as BarqRaftar's own copy rather than reusing Smartlane's worker
because that one loads a remote URL with Smartlane auth headers; this one
renders HTML we built ourselves, with no network access needed at all.

Deliberately has NO Django imports.

Protocol: one JSON object on stdin - {"html", "context"}. On success, raw
PDF bytes on stdout (exit 0). On failure, a plain-text message on stderr
(exit 1).
"""

import json
import sys
import time


def render(html, context):
    from playwright.sync_api import sync_playwright

    started = time.monotonic()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="load", timeout=30000)
            pdf_bytes = page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"},
            )
        finally:
            browser.close()

    print(
        f"barqraftar pdf render {context} -> {len(pdf_bytes)} bytes in {time.monotonic() - started:.2f}s",
        file=sys.stderr,
    )
    return pdf_bytes


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    try:
        pdf_bytes = render(payload["html"], payload.get("context", ""))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(pdf_bytes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
