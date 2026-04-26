import json
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


class ExternalCaptureService:
    def __init__(self, config: BrowserConfig, browser_factory: BrowserSessionFactory):
        self._config = config
        self._browser_factory = browser_factory

    async def capture_external_page(self, url: str, output_path: str) -> Optional[Dict[str, Any]]:
        playwright, browser = await self._browser_factory.launch()
        context = await self._browser_factory.new_external_context(browser)
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=self._config.external_page_timeout_ms)
            await page.wait_for_timeout(3000)
            await dismiss_common_overlays(page)
            await click_start_controls(page)
            game_element = await locate_external_game_surface(page)
            if game_element is None:
                return None
            await game_element.scroll_into_view_if_needed(timeout=5000)
            await page.wait_for_timeout(1200)
            await dismiss_common_overlays(page)
            tag_name = await game_element.evaluate("el => el.tagName.toLowerCase()")
            if tag_name == "iframe":
                await wait_for_iframe_render(page, game_element)
            else:
                await page.wait_for_timeout(5000)
            await game_element.screenshot(path=output_path)
            metadata_path = str(Path(output_path).with_suffix(".json"))
            metadata = await extract_external_page_metadata(page, url)
            Path(metadata_path).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
            return {
                "screenshot_path": output_path,
                "metadata_path": metadata_path,
                "metadata": metadata,
            }
        except Exception:
            return None
        finally:
            await context.close()
            await browser.close()
            await playwright.stop()
