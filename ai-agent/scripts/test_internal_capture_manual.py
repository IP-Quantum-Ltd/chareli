import asyncio
import json

from app.services.browser_agent import capture_game_preview


PROPOSAL_ID = "74098748-0e72-4bbb-b93f-d4a92ad3c249"
GAME_TITLE = "Football Kicks"
THUMBNAIL_URL = "https://staging.cdn.arcadesbox.org/thumbnails/65309581-4de4-4f31-9ccb-fd922f65d6de-whatsapp-image-2025-11-03-at-02.50.34.webp"


async def main() -> None:
    proposal_snapshot = {
        "proposedData": {
            "title": GAME_TITLE,
            "image": THUMBNAIL_URL,
        }
    }

    result = await capture_game_preview(
        proposal_id=PROPOSAL_ID,
        proposal_snapshot=proposal_snapshot,
        game_title=GAME_TITLE,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
