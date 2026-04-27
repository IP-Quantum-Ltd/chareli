import asyncio
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from PIL import Image

from app.config import BrowserConfig
from app.domain.dto import CaptureArtifacts
from app.infrastructure.browser.browser_session_factory import BrowserSessionFactory
from app.infrastructure.browser.page_extractors import dismiss_accept_overlay, wait_for_iframe_render
from app.infrastructure.db.repositories.game_repository import GameRepository


def resolve_thumbnail_url(game_row: Optional[Dict[str, Any]]) -> Optional[str]:
    if not game_row:
        return None
    variants = game_row.get("variants") or {}
    if isinstance(variants, dict):
        for key in ("large", "medium", "thumbnail"):
            if variants.get(key):
                return variants[key]
    s3_key = game_row.get("s3Key")
    if s3_key:
        return f"https://cdn.arcadesbox.org/{s3_key}"
    return None


class InternalCaptureService:
    def __init__(self, config: BrowserConfig, browser_factory: BrowserSessionFactory, game_repository: GameRepository):
        self._config = config
        self._browser_factory = browser_factory
        self._game_repository = game_repository

    async def capture_proposal_gameplay(self, proposal_id: str, output_path: str) -> Dict[str, Any]:
        playwright, browser = await self._browser_factory.launch()
        context = await self._browser_factory.new_internal_context(browser)
        page = await context.new_page()
        try:
            page.set_default_timeout(self._config.internal_page_timeout_ms)
            page.set_default_navigation_timeout(self._config.internal_page_timeout_ms)
            await page.goto(f"{self._config.client_url}/admin/login", wait_until="domcontentloaded", timeout=self._config.internal_page_timeout_ms)
            await page.fill('input[type="email"]', self._config.admin_email)
            await page.fill('input[type="password"]', self._config.admin_password)
            await page.click('button[type="submit"]')
            await page.wait_for_url("**/admin", timeout=self._config.internal_page_timeout_ms)

            preview_url = f"{self._config.client_url}/gameplay/{proposal_id}"
            await page.goto(preview_url, wait_until="domcontentloaded", timeout=self._config.internal_page_timeout_ms)
            await page.wait_for_selector("iframe", state="visible", timeout=self._config.internal_page_timeout_ms)

            game_element = page.locator("iframe").first
            await wait_for_iframe_render(page, game_element)
            await dismiss_accept_overlay(page)
            await game_element.screenshot(path=output_path)
            return {"paths": [output_path], "metadata": {"preview_url": preview_url, "source": "proposal_gameplay"}}
        finally:
            await context.close()
            await browser.close()
            await playwright.stop()

    async def capture_thumbnail_preview(self, thumbnail_url: str, output_path: str) -> str:
        try:
            timeout = httpx.Timeout(max(5.0, self._config.internal_page_timeout_ms / 1000))
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(thumbnail_url)
                response.raise_for_status()
                image_bytes = response.content

            def write_png() -> None:
                with Image.open(BytesIO(image_bytes)) as image:
                    image.convert("RGBA").save(output_path, format="PNG")

            await asyncio.to_thread(write_png)
            return output_path
        except Exception:
            playwright, browser = await self._browser_factory.launch()
            context = await self._browser_factory.new_internal_context(browser)
            page = await context.new_page()
            try:
                page.set_default_timeout(self._config.internal_page_timeout_ms)
                page.set_default_navigation_timeout(self._config.internal_page_timeout_ms)
                await page.set_content(
                    f"""
                    <html>
                      <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111;">
                        <img src="{thumbnail_url}" style="max-width:100%;max-height:100vh;object-fit:contain;" />
                      </body>
                    </html>
                    """,
                    wait_until="load",
                )
                await page.wait_for_selector("img", state="visible", timeout=self._config.internal_page_timeout_ms)
                await page.locator("img").screenshot(path=output_path)
                return output_path
            finally:
                await context.close()
                await browser.close()
                await playwright.stop()

    async def capture_stage0_internal_assets(self, game_id: str, artifact_dir: str) -> CaptureArtifacts:
        game_row = await self._game_repository.get_public_game_with_thumbnail_by_id(game_id)
        if not game_row:
            raise RuntimeError(f"Could not fetch game {game_id} from public.games")
        title = game_row.get("title") or game_id
        output_root = Path(artifact_dir)
        await asyncio.to_thread(output_root.mkdir, parents=True, exist_ok=True)
        thumbnail_path = output_root / "internal_thumbnail.png"
        gameplay_path = output_root / "internal_gameplay.png"
        thumbnail_url = resolve_thumbnail_url(game_row)
        if not thumbnail_url:
            raise RuntimeError(f"No thumbnail URL found for game {game_id}")
        try:
            await asyncio.wait_for(
                self.capture_thumbnail_preview(thumbnail_url, str(thumbnail_path)),
                timeout=max(10, self._config.internal_page_timeout_ms / 1000 + 5),
            )
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"Thumbnail capture timed out for game {game_id}.") from exc
        gameplay_result: Dict[str, Any] = {}
        gameplay_error = ""
        try:
            gameplay_result = await asyncio.wait_for(
                self.capture_proposal_gameplay(game_id, str(gameplay_path)),
                timeout=max(20, (self._config.internal_page_timeout_ms / 1000) * 3),
            )
        except asyncio.TimeoutError as exc:
            gameplay_error = f"Gameplay capture timed out for game {game_id}."
        except Exception as exc:
            gameplay_error = str(exc)
        return CaptureArtifacts(
            game_id=game_id,
            game_title=title,
            thumbnail_url=thumbnail_url,
            paths=[str(thumbnail_path), *([str(gameplay_path)] if gameplay_result.get("paths") else [])],
            metadata={
                "thumbnail_url": thumbnail_url,
                "gameplay_capture": gameplay_result.get("metadata", {}),
                "gameplay_capture_available": bool(gameplay_result.get("paths")),
                "gameplay_capture_error": gameplay_error,
            },
        )
