import asyncio
import json
import sys

from app.services.arcade_client import get_proposal
from app.services.browser_agent import capture_game_preview


async def main() -> None:
    proposal_id = sys.argv[1] if len(sys.argv) > 1 else "74098748-0e72-4bbb-b93f-d4a92ad3c249"
    proposal = await get_proposal(proposal_id)
    proposed_data = proposal.get("proposedData") or {}
    game = proposal.get("game") or {}
    title = (
        proposed_data.get("title")
        or proposed_data.get("name")
        or proposal.get("title")
        or game.get("title")
        or "Unknown Game"
    )

    result = await capture_game_preview(
        proposal_id=proposal_id,
        proposal_snapshot=proposal,
        game_title=title,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
