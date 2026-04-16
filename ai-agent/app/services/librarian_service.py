import logging
import asyncio
from datetime import datetime
from typing import List, Optional, Dict
from sqlalchemy.future import select
from sqlmodel.ext.asyncio.session import AsyncSession
from tavily import TavilyClient

from app.models.database import Game
from app.db.mongo import get_mongodb
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.models.schemas import KnowledgeChunk
from app.models.enums import SearchDepth

class LibrarianService(BaseService, BaseAIClient):
    """
    Stage 2 (The Librarian): Fetches deterministic metadata from PG, explores
    deep content across the web using Tavily (Victoria's Layer), 
    chunks it, and upserts to MongoDB Atlas following a 3-step flow.
    """
    
    def __init__(self, pg_session: AsyncSession):
        super().__init__()
        self.pg_session = pg_session
        self.mongo_collection = None
        # Use simple TavilyClient (standard for tavily-python 0.3.x)
        self.tavily_client = TavilyClient(api_key=settings.TAVILY_API_KEY)

    async def _init_mongo(self):
        """Initialize MongoDB collection reference for knowledge chunks."""
        if self.mongo_collection is None:
            mongodb = await get_mongodb()
            self.mongo_collection = mongodb["game_knowledge_chunks"]

    def _chunk_text(self, text: str, chunk_size: int = 2000, overlap: int = 300) -> List[str]:
        """Splits text into character chunks with overlap for semantic retention."""
        if not text:
            return []
        
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunks.append(text[start:end])
            start += chunk_size - overlap
        
        return chunks

    async def enrich_game(self, pg_id: str, seo_blueprint: Optional[Dict] = None, depth: SearchDepth = SearchDepth.ADVANCED, persist: bool = True) -> Optional[int]:
        """
        Deep enrichment loop for a single game following the 3-step flow:
        1. Websearch -> 2. Pydantic Validation -> 3. MongoDB Upsert (optional)
        """
        self.logger.info(f"Librarian started for PG ID: {pg_id} (persist={persist})")
        
        # 0. Internal Query (Postgres)
        result = await self.pg_session.execute(select(Game).where(Game.id == pg_id))
        game = result.scalars().first()
        
        if not game:
            self.logger.error(f"Game with ID {pg_id} not found in Postgres.")
            return None
            
        self.logger.info(f"Retrieved game from PG: {game.title}")
        
        # 1. Websearch (Tavily)
        search_query = f"{game.title} game official patch notes features and gameplay guide"
        if seo_blueprint and seo_blueprint.get("required_entities"):
            search_query += " " + " ".join(seo_blueprint["required_entities"][:3])

        self.logger.info(f"Step 1: Executing Tavily search: '{search_query}'")
        
        try:
            # Tavily 0.3.3 search is synchronous, we run it in executor to avoid blocking
            loop = asyncio.get_event_loop()
            tavily_response = await loop.run_in_executor(
                None, 
                lambda: self.tavily_client.search(
                    query=search_query,
                    search_depth=depth.value, 
                    include_raw_content=True,
                    max_results=3 # Adjusted back to 3
                )
            )
        except Exception as e:
            self.logger.error(f"Tavily search failed: {e}")
            return None

        results = tavily_response.get("results", [])
        if not results:
            self.logger.warning(f"No external content found via Tavily for {game.title}")
            return None
            
        combined_text = ""
        for r in results:
            raw_content = r.get("raw_content") or r.get("content") or ""
            combined_text += f"\n\n--- Source: {r.get('url')} ---\n"
            combined_text += raw_content
            
        if not combined_text.strip():
            self.logger.warning("Combined Tavily raw content is mostly empty.")
            return None
            
        self.logger.info(f"Step 1 Complete: Harvested {len(combined_text)} characters of raw content.")
        
        # 2. Pydantic & Chunking
        chunks = self._chunk_text(combined_text)
        await self._init_mongo()
        
        # Clean previous chunks to prevent duplication
        await self.mongo_collection.delete_many({"pg_id": pg_id})
        
        # 3. Embedding & MongoDB Upsert
        inserted_chunks = 0
        for idx, chunk_str in enumerate(chunks):
            try:
                embedding = await self.generate_embedding(chunk_str)
                
                # Step 2: Pydantic Validation
                chunk_data = KnowledgeChunk(
                    pg_id=pg_id,
                    title=game.title,
                    chunk_index=idx,
                    content=chunk_str,
                    embedding=embedding,
                    timestamp=datetime.utcnow()
                )
                
                # Step 3: MongoDB Upsert
                if persist:
                    await self.mongo_collection.insert_one(chunk_data.model_dump())
                    inserted_chunks += 1
                else:
                    self.logger.debug(f"[Trial] Would have inserted chunk {idx}")
                    inserted_chunks += 1
            except Exception as e:
                self.logger.error(f"Failed to embed/upsert chunk {idx}: {e}")
                
        self.logger.info(f"Step 3 Complete: Successfully saved {inserted_chunks} chunks for '{game.title}' to MongoDB.")
        return inserted_chunks
