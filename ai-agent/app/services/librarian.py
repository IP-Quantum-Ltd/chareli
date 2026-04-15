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

    async def enrich_game_data(self, pg_game_id: str, title: str) -> Dict[str, Any]:
        """
        Enriches a game's metadata with live facts (patch notes, official release dates, etc.)
        """
        logger.info(f"Librarian researching live facts for: {title}")

        # 1. Search for official facts
        queries = [
            f"{title} official release date and platforms",
            f"{title} latest patch notes and updates",
            f"{title} game features and developer official site"
        ]
        
        all_results = []
        for q in queries:
            results = await self.search.universal_search(q, max_results=3)
            all_results.extend(results)

        context = "\n".join([f"Source ({r['url']}): {r['content']}" for r in all_results])

        # 2. Extract structured data with LLM
        prompt = f"""
        Research Context for '{title}':
        {context}
        
        Your task: Extract accurate, verified facts for this game.
        Identify:
        - Release Date
        - Developer/Publisher
        - Verified Platforms
        - Key Features/Mechanics
        - Latest version/Update info
        
        Return a JSON object format. Be extremely factual. If a fact is not found, set to null.
        """

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a fact-checking game archivist (The Librarian). Respond only with JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            enriched_facts = json.loads(response.choices[0].message.content)
            
            # 3. Store in MongoDB Enriched collection
            mongodb = await get_mongodb()
            collection = mongodb["enriched_knowledge"]
            
            document = {
                "pg_id": str(pg_game_id),
                "title": title,
                "facts": enriched_facts,
                "sources": [r['url'] for r in all_results],
                "last_researched": datetime.utcnow()
            }
            
            await collection.update_one(
                {"pg_id": str(pg_game_id)},
                {"$set": document},
                upsert=True
            )
            
            return enriched_facts

        except Exception as e:
            logger.error(f"Librarian enrichment failed for {title}: {e}")
            return {}

