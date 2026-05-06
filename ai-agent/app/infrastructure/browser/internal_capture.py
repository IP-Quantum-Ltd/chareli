import asyncio
import shutil
import tempfile
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
from app.infrastructure.storage.s3_storage_service import S3StorageService


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
    def __init__(
        self,
        config: BrowserConfig,
        browser_factory: BrowserSessionFactory,
        game_repository: GameRepository,
        s3: S3StorageService,
    ):
        self._config = config
        self._browser_factory = browser_factory
        self._game_repository = game_repository
        self._s3 = s3

    async def capture_proposal_gameplay(self, proposal_id: str, output_path: str) -> Dict[str, Any]:
        """Navigate directly to the public gameplay preview and screenshot it."""
        playwright, browser = await self._browser_factory.launch()
        context = await self._browser_factory.new_internal_context(browser)
        page = await context.new_page()
        preview_url = f"{self._config.client_url}/gameplay/{proposal_id}"
        try:
            page.set_default_timeout(self._config.internal_page_timeout_ms)
            page.set_default_navigation_timeout(self._config.internal_page_timeout_ms)
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

    async def capture_stage0_internal_assets(self, game_id: str, proposal_id: str) -> CaptureArtifacts:
        """Capture thumbnail + gameplay, upload both to S3, return in-memory bytes.

        A temporary directory is used for Playwright's output and is removed
        immediately after the S3 uploads complete — nothing persists on disk.
        """
        game_row = await self._game_repository.get_public_game_with_thumbnail_by_id(game_id)
        if not game_row:
            raise RuntimeError(f"Could not fetch game {game_id} from public.games")
        title = game_row.get("title") or game_id
        thumbnail_url = resolve_thumbnail_url(game_row)
        if not thumbnail_url:
            raise RuntimeError(f"No thumbnail URL found for game {game_id}")

        tmpdir = Path(await asyncio.to_thread(tempfile.mkdtemp, prefix="arcadebox_cap_"))
        try:
            thumbnail_tmp = str(tmpdir / "internal_thumbnail.png")
            gameplay_tmp = str(tmpdir / "internal_gameplay.png")

            # --- thumbnail ---
            try:
                await asyncio.wait_for(
                    self.capture_thumbnail_preview(thumbnail_url, thumbnail_tmp),
                    timeout=max(10, self._config.internal_page_timeout_ms / 1000 + 5),
                )
            except asyncio.TimeoutError as exc:
                raise TimeoutError(f"Thumbnail capture timed out for game {game_id}.") from exc

            # --- gameplay (mandatory — fail fast if browser cannot reach it) ---
            try:
                await asyncio.wait_for(
                    self.capture_proposal_gameplay(game_id, gameplay_tmp),
                    timeout=max(20, (self._config.internal_page_timeout_ms / 1000) * 3),
                )
            except asyncio.TimeoutError as exc:
                raise TimeoutError(f"Gameplay capture timed out for game {game_id}.") from exc

            thumb_key = self._s3.proposal_key(proposal_id, "internal_thumbnail.png")
            play_key = self._s3.proposal_key(proposal_id, "internal_gameplay.png")

            # Upload both concurrently while files still exist in tmpdir
            thumb_bytes = await asyncio.to_thread(Path(thumbnail_tmp).read_bytes)
            play_bytes = await asyncio.to_thread(Path(gameplay_tmp).read_bytes)

            await asyncio.gather(
                self._s3.upload(thumb_key, thumb_bytes, "image/png"),
                self._s3.upload(play_key, play_bytes, "image/png"),
            )
            # Bytes no longer needed — generate presigned URLs for the LLM
            del thumb_bytes, play_bytes

        finally:
            await asyncio.to_thread(shutil.rmtree, str(tmpdir), True)

        # Presigned URLs generated after tmpdir cleanup — S3 objects are already persisted
        thumb_url, play_url = await asyncio.gather(
            self._s3.image_url(thumb_key),
            self._s3.image_url(play_key),
        )

        return CaptureArtifacts(
            game_id=game_id,
            game_title=title,
            thumbnail_url=thumbnail_url,
            paths=[thumb_key, play_key],
            image_urls=[thumb_url, play_url],
            metadata={
                "thumbnail_url": thumbnail_url,
                "gameplay_capture": {"preview_url": f"{self._config.client_url}/gameplay/{game_id}", "source": "proposal_gameplay"},
                "gameplay_capture_available": True,
            },
        )
