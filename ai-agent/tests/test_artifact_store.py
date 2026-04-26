import json
import tempfile
import unittest
from pathlib import Path

from app.domain.dto import CandidateCapture
from app.infrastructure.storage.artifact_store import ArtifactStore


class ArtifactStoreTests(unittest.TestCase):
    def test_writes_manifest_and_findings(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ArtifactStore(Path(temp_dir))
            proposal_dir, _ = store.ensure_proposal_dirs("proposal-1")
            manifest_path = store.write_manifest(proposal_dir, {"status": "ok"})
            findings_path = store.write_research_findings(
                proposal_id="proposal-1",
                game_title="Game",
                search_query="game query",
                candidates=[
                    CandidateCapture(
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
                ],
                failures=[],
                total_cost_usd=0.42,
            )

            self.assertTrue(Path(manifest_path).exists())
            self.assertTrue(Path(findings_path).exists())
            self.assertEqual(json.loads(Path(manifest_path).read_text())["status"], "ok")
