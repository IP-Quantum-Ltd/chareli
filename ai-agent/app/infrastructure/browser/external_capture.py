import asyncio
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

from app.config import BrowserConfig
from app.infrastructure.browser.browser_session_factory import BrowserSessionFactory
from app.infrastructure.browser.page_extractors import (
    click_start_controls,
    dismiss_common_overlays,
    extract_external_page_metadata,
    locate_external_game_surface,
    wait_for_iframe_render,
)
from app.infrastructure.storage.s3_storage_service import S3StorageService


class ExternalCaptureService:
    def __init__(
        self,
        config: BrowserConfig,
        browser_factory: BrowserSessionFactory,
        s3: S3StorageService,
    ):
        self._config = config
        self._browser_factory = browser_factory
        self._s3 = s3

    async def capture_external_page(
        self,
        url: str,
        proposal_id: str,
        index: int,
    ) -> Optional[Dict[str, Any]]:
        """Capture a screenshot of an external URL and upload it to S3.

        Returns a dict with:
            screenshot_path  — S3 key for the PNG
            metadata_path    — S3 key for the JSON metadata
            screenshot_url   — presigned URL for direct LLM use
            metadata         — page metadata dict
        Returns None if the page could not be captured.
        """
        # Playwright requires a local file path; we use a named temp file that
        # is deleted immediately after the S3 upload completes.
        fd, tmp_str = await asyncio.to_thread(
            tempfile.mkstemp, ".png", "ext_cap_"
        )
        await asyncio.to_thread(__import__("os").close, fd)
        tmp_path = Path(tmp_str)

        playwright, browser = await self._browser_factory.launch()
        context = await self._browser_factory.new_external_context(browser)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=self._config.external_page_timeout_ms)
            await page.wait_for_timeout(3000)
            await dismiss_common_overlays(page)
            await click_start_controls(page)
            metadata = await extract_external_page_metadata(page, url)
            game_element = await locate_external_game_surface(page)

            if game_element is None:
                metadata["capture_mode"] = "page_fallback"
                await page.screenshot(path=str(tmp_path), full_page=False)
            else:
                try:
                    await game_element.scroll_into_view_if_needed(timeout=5000)
                    await page.wait_for_timeout(1200)
                    await dismiss_common_overlays(page)
                    tag_name = await game_element.evaluate("el => el.tagName.toLowerCase()")
                    metadata["capture_mode"] = "element"
                    metadata["capture_tag"] = tag_name
                    if tag_name == "iframe":
                        await wait_for_iframe_render(page, game_element)
                    else:
                        await page.wait_for_timeout(5000)
                    await game_element.screenshot(path=str(tmp_path))
                except Exception:
                    metadata["capture_mode"] = "page_fallback_after_surface_error"
                    await page.screenshot(path=str(tmp_path), full_page=False)

            screenshot_bytes = await asyncio.to_thread(tmp_path.read_bytes)

        except Exception:
            return None
        finally:
            await context.close()
            await browser.close()
            await playwright.stop()
            await asyncio.to_thread(tmp_path.unlink, True)

        png_key = self._s3.proposal_key(proposal_id, "external", f"candidate_{index:02d}_render.png")
        json_key = self._s3.proposal_key(proposal_id, "external", f"candidate_{index:02d}_render.json")

        png_s3_key, json_s3_key = await asyncio.gather(
            self._s3.upload(png_key, screenshot_bytes, "image/png"),
            self._s3.upload_json(json_key, metadata),
        )
        del screenshot_bytes

        screenshot_url = await self._s3.image_url(png_s3_key)

        return {
            "screenshot_path": png_s3_key,
            "metadata_path": json_s3_key,
            "screenshot_url": screenshot_url,
            "metadata": metadata,
        }
