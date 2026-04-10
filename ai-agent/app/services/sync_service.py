import logging
from datetime import datetime
from typing import List
from sqlalchemy.future import select
from sqlmodel.ext.asyncio.session import AsyncSession
from app.models.database import Game
from app.db.mongo import get_mongodb
from app.config import settings
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

async def generate_embedding(text: str) -> List[float]:
    """Generate vector embedding for a given text using OpenAI."""
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.embeddings.create(
        input=[text.replace("\n", " ")],
        model=settings.EMBEDDING_MODEL
    )
    return response.data[0].embedding

async def sync_pg_to_mongo(pg_session: AsyncSession):
    """
    Sync all game metadata from PostgreSQL to MongoDB Atlas.
    Creates a searchable summary and generates vector embeddings.
    """
    try:
        mongodb = await get_mongodb()
        collection = mongodb["game_summaries"]

        # Fetch all games from PG
        logger.info("Fetching games from PostgreSQL for sync...")
        result = await pg_session.execute(select(Game))
        games = result.scalars().all()

        count = 0
        for game in games:
            try:
                # Create a searchable summary string
                summary_text = f"Title: {game.title} | Developer: {game.createdById or 'Unknown'} | Description: {game.description or 'No description available'}"
                
                if game.game_metadata:
                    summary_text += f" | Details: {str(game.game_metadata)}"

                # Generate embedding for vector search
                embedding = await generate_embedding(summary_text)

                # Upsert into MongoDB
                document = {
                    "pg_id": game.id,
                    "title": game.title,
                    "summary": summary_text,
                    "embedding": embedding,
                    "last_synced": game.updatedAt or datetime.utcnow()
                }

                await collection.update_one(
                    {"pg_id": game.id},
                    {"$set": document},
                    upsert=True
                )
                count += 1
                if count % 10 == 0:
                    logger.info(f"Synced {count}/{len(games)} games...")
            except Exception as e:
                logger.error(f"Failed to sync game {game.id} ({game.title}): {e}")

        logger.info(f"Successfully synced {count} games from PG to MongoDB")
        return count
    except Exception as e:
        logger.error(f"Critical error during sync: {e}")
        raise
