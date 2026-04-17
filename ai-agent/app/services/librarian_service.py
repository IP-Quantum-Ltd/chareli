import logging
import asyncio
from datetime import datetime
from typing import List, Optional
from sqlalchemy.future import select
from sqlmodel.ext.asyncio.session import AsyncSession
from tavily import TavilyClient

from app.models.database import Game
from app.db.mongo import get_mongodb
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.models.enums import SearchDepth

class LibrarianService(BaseService, BaseAIClient):
    """
    Stage 2 (The Librarian): Fetches deterministic metadata from PG, explores
    deep content across the web using Tavily (Victoria's Layer), 
    chunks it, and upserts to MongoDB Atlas.
    """
    
    def __init__(self, pg_session: AsyncSession):
        super().__init__()
        self.pg_session = pg_session
        self.mongo_collection = None
        # Standard synchronous Tavily Client (used with async wrapper)
        self.tavily_client = TavilyClient(api_key=settings.TAVILY_API_KEY)

    async def _init_mongo(self):
        """Initialize MongoDB collection reference for knowledge chunks."""
        if self.mongo_collection is None:
            mongodb = await get_mongodb()
            self.mongo_collection = mongodb["game_knowledge_chunks"]

    def _chunk_text(self, text: str, chunk_size: int = 1500, overlap: int = 200) -> List[str]:
        """Splits text into character chunks with quality filtering."""
        if not text:
            return []
        
        raw_chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            raw_chunks.append(text[start:end])
            start += chunk_size - overlap
        
        # QUALITY FILTER: Remove chunks that are likely noise
        clean_chunks = []
        for c in raw_chunks:
            # 1. Skip if too short
            if len(c.strip()) < 200:
                continue
            
            # 2. Skip if high density of numbers/symbols (likely a data table or version list)
            digit_count = sum(1 for char in c if char.isdigit())
            if digit_count / len(c) > 0.3: # More than 30% numbers? Probably noise.
                continue
                
            clean_chunks.append(c.strip())
        
        return clean_chunks

    async def enrich_game(self, pg_id: str, depth: SearchDepth = SearchDepth.ADVANCED) -> Optional[int]:
        """
        Deep enrichment loop for a single game.
        """
        self.logger.info(f"Librarian started for PG ID: {pg_id} with depth={depth}")
        
        # 1. Internal Query (Postgres)
        result = await self.pg_session.execute(select(Game).where(Game.id == pg_id))
        game = result.scalars().first()
        
        if not game:
            self.logger.error(f"Game with ID {pg_id} not found in Postgres.")
            return None
            
        self.logger.info(f"Retrieved game from PG: {game.title}")
        
        # 2. External Query (Tavily) with Arcade Focus
        search_query = f"{game.title} arcade browser game guide walkthrough tricks"
        self.logger.info(f"Executing Tavily search with Arcade Context: '{search_query}'")
        
        try:
            # Tavily 0.3.3 search is synchronous, we run it in executor to avoid blocking
            loop = asyncio.get_event_loop()
            tavily_response = await loop.run_in_executor(
                None, 
                lambda: self.tavily_client.search(
                    query=search_query,
                    search_depth=depth.value, 
                    include_raw_content=True,
                    max_results=3
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
            
        self.logger.info(f"Harvested {len(combined_text)} characters of raw content.")
        
        # 3. Chunking & Storage initialization
        chunks = self._chunk_text(combined_text)
        await self._init_mongo()
        
        # Clean previous chunks to prevent duplication
        await self.mongo_collection.delete_many({"pg_id": pg_id})
        
        # 4. Embedding & Upsert
        inserted_chunks = 0
        for idx, chunk_str in enumerate(chunks):
            try:
                embedding = await self.generate_embedding(chunk_str)
                document = {
                    "pg_id": pg_id,
                    "title": game.title,
                    "chunk_index": idx,
                    "content": chunk_str,
                    "embedding": embedding,
                    "timestamp": datetime.utcnow()
                }
                await self.mongo_collection.insert_one(document)
                inserted_chunks += 1
            except Exception as e:
                self.logger.error(f"Failed to embed/upsert chunk {idx}: {e}")
                
        self.logger.info(f"Successfully digested {inserted_chunks} chunks for '{game.title}'.")
        return inserted_chunks
