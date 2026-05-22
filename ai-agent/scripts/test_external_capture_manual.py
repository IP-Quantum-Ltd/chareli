"""
Manual test for ExternalCaptureService.capture_external_page.

Usage (from ai-agent/ root with venv active):
  python -m scripts.test_external_capture_manual
  python -m scripts.test_external_capture_manual <url1> <url2> ...

Runs each URL through the capture pipeline in isolation, times it, and
prints the capture mode and metadata so you can diagnose failures without
running full Stage 0.
"""

import asyncio
import sys
import time

from app.runtime import get_runtime

DEFAULT_URLS = [
    "https://www.crazygames.com/game/football-kicks",
    "https://poki.com/en/g/football-kicks",
]

PROPOSAL_ID = "test-capture-manual"


async def test_url(service, url: str, index: int) -> None:
    print(f"\n[{index}] {url}")
    start = time.monotonic()
    try:
        result = await service.capture_external_page(url, PROPOSAL_ID, index)
        elapsed = time.monotonic() - start
        if result is None:
            print(f"    FAILED — capture returned None ({elapsed:.1f}s)")
        else:
            mode = result["metadata"].get("capture_mode", "unknown")
            tag = result["metadata"].get("capture_tag", "")
            title = result["metadata"].get("title", "")[:80]
            print(f"    OK — mode={mode}{f'/{tag}' if tag else ''} elapsed={elapsed:.1f}s")
            print(f"    title: {title}")
            print(f"    screenshot: {result['screenshot_path']}")
    except asyncio.TimeoutError:
        elapsed = time.monotonic() - start
        print(f"    TIMEOUT — asyncio.wait_for fired after {elapsed:.1f}s")
    except Exception as exc:
        elapsed = time.monotonic() - start
        print(f"    ERROR — {type(exc).__name__}: {exc} ({elapsed:.1f}s)")


async def main() -> None:
    urls = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_URLS
    runtime = get_runtime()
    service = runtime.external_capture

    print(f"Testing {len(urls)} URL(s) — external_page_timeout_ms={runtime.config.browser.external_page_timeout_ms}")

    for i, url in enumerate(urls, start=1):
        await test_url(service, url, i)

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
