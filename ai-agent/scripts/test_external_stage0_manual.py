import asyncio
import base64
import json
from pathlib import Path

from app.runtime import get_runtime


PROPOSAL_ID = "74098748-0e72-4bbb-b93f-d4a92ad3c249"
GAME_TITLE = "Football Kicks"
INTERNAL_DIR = Path("stage0_artifacts") / PROPOSAL_ID / "internal"


async def main() -> None:
    internal_paths = [
        INTERNAL_DIR / "reference_thumbnail.png",
        INTERNAL_DIR / "reference_gameplay_start.png",
    ]

    internal_base64 = []
    for path in internal_paths:
        with open(path, "rb") as handle:
            internal_base64.append(base64.b64encode(handle.read()).decode("utf-8"))

    runtime = get_runtime()
    result = await runtime.visual_verification.verify_and_research(
        proposal_id=PROPOSAL_ID,
        game_title=GAME_TITLE,
        internal_screenshots=internal_base64,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
