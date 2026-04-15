import json
import logging
from datetime import datetime
from typing import List, Dict, Any
from app.db.mongo import get_mongodb
from app.services.base import BaseAIClient, BaseService
from app.services.search_service import SearchService

logger = logging.getLogger(__name__)

class LibrarianService(BaseService, BaseAIClient):
    """
    Stage 2: The Librarian.
    Merges internal PG data with live web research to create an enriched Knowledge Hub.
    """

    def __init__(self):
        super().__init__()
        self.search = SearchService()

    async def enrich_game_data(self, pg_game_id: str, title: str) -> List[Dict[str, Any]]:
        """
        Stage 2: Deep research using Tavily.
        Scrapes authoritative sources and stores results as semantic 'knowledge chunks'.
        """
        logger.info(f"Librarian performing deep research for: {title}")

        # 1. Deep research using Tavily (Scraping mode)
        search_results = await self.search.search_tavily(
            f"{title} game guide walkthrough patch notes official features", 
            max_results=5
        )
        
        chunks_to_store = []
        
        for idx, result in enumerate(search_results):
            content = result.get("content", "")
            if not content:
                continue

            # In a real scenario, we might further split 'content' into smaller chunks if it's very long
            # For now, each search result is treated as a chunk as per colleague's hint
            
            summary_text = f"Source: {result.get('url')} | Content: {content}"
            embedding = await self.generate_embedding(summary_text)

            chunk = {
                "pg_id": str(pg_game_id),
                "title": title,
                "chunk_index": idx,
                "content": content,
                "url": result.get("url"),
                "embedding": embedding,
                "timestamp": datetime.utcnow().isoformat()
            }
            chunks_to_store.append(chunk)

        # 2. Store in MongoDB 'knowledge_chunks' collection
        if chunks_to_store:
            mongodb = await get_mongodb()
            collection = mongodb["knowledge_chunks"] # Using colleague's terminolgy
            
            # Clear old chunks for this game to avoid duplicates (optional, based on preference)
            await collection.delete_many({"pg_id": str(pg_game_id)})
            
            await collection.insert_many(chunks_to_store)
            logger.info(f"Stored {len(chunks_to_store)} chunks for {title}")

        return chunks_to_store

