import asyncio
import json
import sys

from app.runtime import get_runtime


async def main() -> None:
    runtime = get_runtime()
    proposal_id = sys.argv[1] if len(sys.argv) > 1 else "74098748-0e72-4bbb-b93f-d4a92ad3c249"
    proposal = await runtime.arcade_client.get_proposal(proposal_id)
    proposed_data = proposal.get("proposedData") or {}
    game = proposal.get("game") or {}
    title = (
        proposed_data.get("title")
        or proposed_data.get("name")
        or proposal.get("title")
        or game.get("title")
        or "Unknown Game"
    )

    result = await runtime.internal_capture.capture_proposal_gameplay(
        proposal_id=proposal_id,
        output_path=f"test_internal_{proposal_id}.png",
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
