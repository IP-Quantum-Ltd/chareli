import unittest
from unittest.mock import AsyncMock, MagicMock

from app.domain.dto import CandidateCapture
from app.infrastructure.storage.artifact_store import ArtifactStore


class ArtifactStoreTests(unittest.IsolatedAsyncioTestCase):
    def _make_store(self) -> tuple[ArtifactStore, MagicMock]:
        s3 = MagicMock()
        s3.proposal_key.side_effect = lambda proposal_id, *parts: "/".join(["ai-agent", proposal_id, *parts])
        s3.upload_json = AsyncMock(side_effect=lambda key, _payload: key)
        return ArtifactStore(s3), s3

    async def test_write_manifest_uploads_to_correct_key(self) -> None:
        store, s3 = self._make_store()
        key = await store.write_manifest("proposal-1", {"status": "ok"})
        self.assertEqual(key, "ai-agent/proposal-1/stage0_manifest.json")
        s3.upload_json.assert_awaited_once()
        _, payload = s3.upload_json.call_args.args
        self.assertEqual(payload["status"], "ok")

    async def test_write_research_findings_uploads_to_correct_key(self) -> None:
        store, s3 = self._make_store()
        candidate = CandidateCapture(
            rank=1,
            url="https://example.com",
            search_query="game query",
            screenshot_path="shot.png",
            metadata_path="meta.json",
            metadata={},
            correlation={},
            seo_intelligence={},
            scoring={},
            confidence_score=75,
            reasoning="match",
            extracted_facts={},
            comparison_triplet={},
        )
        key = await store.write_research_findings(
            proposal_id="proposal-1",
            game_title="Game",
            search_query="game query",
            candidates=[candidate],
            failures=[],
            total_cost_usd=0.42,
        )
        self.assertEqual(key, "ai-agent/proposal-1/research_findings.json")
        _, payload = s3.upload_json.call_args.args
        self.assertEqual(payload["game_title"], "Game")
        self.assertEqual(len(payload["all_candidates"]), 1)
        self.assertAlmostEqual(payload["total_cost_usd"], 0.42)
