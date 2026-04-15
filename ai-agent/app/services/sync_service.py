from datetime import datetime
from typing import List
from sqlalchemy.future import select
from sqlmodel.ext.asyncio.session import AsyncSession
from app.models.database import Game
from app.db.mongo import get_mongodb
from app.services.base import BaseAIClient, BaseService

class SyncService(BaseService, BaseAIClient):
    """
    Sync Service to coordinate PostgreSQL to MongoDB Atlas data migration.
    Inherits from BaseAIClient for embedding generation.
    """
    
    def __init__(self, pg_session: AsyncSession):
        super().__init__()
        self.pg_session = pg_session
        self.mongo_collection = None

    async def _init_mongo(self):
        """Initialize MongoDB collection reference."""
        if self.mongo_collection is None:
            mongodb = await get_mongodb()
            self.mongo_collection = mongodb["game_summaries"]

    async def sync_all(self) -> int:
        """
        Sync all game metadata from PostgreSQL to MongoDB Atlas.
        Creates a searchable summary and generates vector embeddings.
        """
        try:
            await self._init_mongo()
            
            # Fetch all games from PG
            self.logger.info("Fetching games from PostgreSQL for sync...")
            result = await self.pg_session.execute(select(Game))
            games = result.scalars().all()

            count = 0
            for game in games:
                try:
                    # Create a searchable summary string
                    summary_text = (
                        f"Title: {game.title} | "
                        f"Developer: {game.createdById or 'Unknown'} | "
                        f"Description: {game.description or 'No description available'}"
                    )
                    
                    if game.game_metadata:
                        summary_text += f" | Details: {str(game.game_metadata)}"

                    # Generate embedding for vector search via BaseAIClient
                    embedding = await self.generate_embedding(summary_text)

                    # Upsert into MongoDB
                    document = {
                        "pg_id": str(game.id),
                        "title": game.title,
                        "summary": summary_text,
                        "embedding": embedding,
                        "last_synced": game.updatedAt or datetime.utcnow()
                    }

                    await self.mongo_collection.update_one(
                        {"pg_id": str(game.id)},
                        {"$set": document},
                        upsert=True
                    )
                    count += 1
                    if count % 10 == 0:
                        self.logger.info(f"Synced {count}/{len(games)} games...")
                except Exception as e:
                    self.logger.error(f"Failed to sync game {game.id} ({game.title}): {e}")

            self.logger.info(f"Successfully synced {count} games from PG to MongoDB")
            return count
        except Exception as e:
            self.logger.error(f"Critical error during sync: {e}")
            raise
