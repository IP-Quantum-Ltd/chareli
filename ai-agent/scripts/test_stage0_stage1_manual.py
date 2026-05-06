import asyncio
import base64
import json
import sys
from pathlib import Path

from app.runtime import get_runtime


DEFAULT_PROPOSAL_ID = "74098748-0e72-4bbb-b93f-d4a92ad3c249"
DEFAULT_GAME_TITLE = "Football Kicks"


def _load_image_base64(path: Path) -> str:
    with open(path, "rb") as handle:
        return base64.b64encode(handle.read()).decode("utf-8")


async def main() -> None:
    proposal_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROPOSAL_ID
    game_title = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_GAME_TITLE

    proposal_dir = Path("stage0_artifacts") / proposal_id
    internal_dir = proposal_dir / "internal"
    output_path = proposal_dir / "stage0_stage1_report.json"

    internal_paths = [
        internal_dir / "reference_thumbnail.png",
        internal_dir / "reference_gameplay_start.png",
    ]
    missing = [str(path) for path in internal_paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing internal screenshots: {missing}")

    internal_screenshots = [_load_image_base64(path) for path in internal_paths]

    runtime = get_runtime()
    investigation = await runtime.visual_verification.verify_and_research(
        proposal_id=proposal_id,
        game_title=game_title,
        internal_screenshots=internal_screenshots,
    )

    seo_blueprint = await runtime.analyst.analyze_seo_potential(
        game_title=game_title,
        investigation=investigation,
    )

    report = {
        "proposal_id": proposal_id,
        "game_title": game_title,
        "comparison_confidence_source": "stage0_visual_librarian",
        "comparison_scores_path": investigation.get("comparison_scores_path", ""),
        "investigation": investigation,
        "seo_blueprint": seo_blueprint,
    }

    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output_path": str(output_path), "status": investigation.get("status", "unknown")}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
