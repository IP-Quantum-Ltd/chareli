import unittest
from unittest.mock import AsyncMock

from app.config.runtime_config import BrowserConfig
from app.infrastructure.browser.internal_capture import InternalCaptureService


class InternalCaptureServiceTests(unittest.IsolatedAsyncioTestCase):
    def _make_service(self) -> InternalCaptureService:
        return InternalCaptureService(
            config=BrowserConfig(
                client_url="https://staging.arcadesbox.com",
                viewport_width=1280,
                viewport_height=800,
                external_page_timeout_ms=45000,
                internal_page_timeout_ms=15000,
            ),
            browser_factory=AsyncMock(),
            game_repository=AsyncMock(),
            s3=AsyncMock(),
        )

    async def test_capture_prefers_direct_game_file_url(self) -> None:
        service = self._make_service()
        service._capture_embedded_gameplay = AsyncMock(return_value={"metadata": {"source": "direct_game_file"}})  # type: ignore[method-assign]
        service._capture_gameplay_frame = AsyncMock()  # type: ignore[method-assign]

        result = await service.capture_proposal_gameplay(
            game_id="game-123",
            output_path="/tmp/out.png",
            direct_gameplay_url="https://cdn.arcadesbox.org/game/index.html",
        )

        self.assertEqual(result["metadata"]["source"], "direct_game_file")
        service._capture_embedded_gameplay.assert_awaited_once_with(  # type: ignore[attr-defined]
            "https://cdn.arcadesbox.org/game/index.html",
            "/tmp/out.png",
        )
        service._capture_gameplay_frame.assert_not_called()  # type: ignore[attr-defined]

    async def test_capture_falls_back_to_public_gameplay_page_when_direct_url_missing(self) -> None:
        service = self._make_service()
        service._capture_embedded_gameplay = AsyncMock()  # type: ignore[method-assign]
        service._capture_gameplay_frame = AsyncMock(return_value={"metadata": {"source": "proposal_gameplay"}})  # type: ignore[method-assign]

        result = await service.capture_proposal_gameplay(
            game_id="game-123",
            output_path="/tmp/out.png",
        )

        self.assertEqual(result["metadata"]["source"], "proposal_gameplay")
        service._capture_embedded_gameplay.assert_not_called()  # type: ignore[attr-defined]
        service._capture_gameplay_frame.assert_awaited_once_with(  # type: ignore[attr-defined]
            "https://staging.arcadesbox.com/gameplay/game-123",
            "/tmp/out.png",
            source="proposal_gameplay",
        )
