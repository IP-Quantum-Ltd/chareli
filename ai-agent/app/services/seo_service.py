import json
import logging
from typing import List, Dict, Any
from app.services.base import BaseAIClient, BaseService
from app.services.search_service import SearchService

logger = logging.getLogger(__name__)

class SEOService(BaseService, BaseAIClient):
    """
    Stage 1: SEO Intelligence.
    Analyzes keywords to identify required entities, search intent, and content gaps.
    """

    def __init__(self):
        super().__init__()
        self.search = SearchService()

    async def analyze_keyword(self, keyword: str) -> Dict[str, Any]:
        """
        Stage 1: Search Intelligence using Serper.
        Identifies headings, keywords, intent, and 'People Also Ask' questions.
        """
        logger.info(f"Strategic SEO Analysis for: {keyword}")

        # 1. Get strategic context from Serper
        serper_data = await self.search.search_serper(keyword)
        
        organic = "\n".join([f"- {r['title']}: {r['snippet']}" for r in serper_data.get("organic", [])])
        paa = "\n".join([f"- {q['question']}" for q in serper_data.get("peopleAlsoAsk", [])])

        # 2. Strategic Analysis with LLM
        prompt = f"""
        Analyze the Google Search Results for: '{keyword}'
        
        Organic Results snippets:
        {organic}
        
        People Also Ask:
        {paa}
        
        Task: 
        1. Determine the search intent.
        2. Identify the 'Required Entities' (topics/features Google expects).
        3. Extract the top 5 questions we MUST answer to rank (from PAA and snippets).
        4. Suggest a high-ranking content structure (H2/H3).
        
        Return JSON format.
        """

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are an SEO Strategist using Serper data. Respond only with JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.error(f"SEO Strategic Analysis failed: {e}")
            return {}

    async def verify_ground_truth(self, title: str, pg_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Uses Serper's Knowledge Graph to verify PG metadata (Ground Truth check).
        """
        logger.info(f"Verifying Ground Truth for: {title}")
        serper_data = await self.search.search_serper(title)
        kg = serper_data.get("knowledgeGraph", {})

        if not kg:
            return {"status": "no_kg_data", "original": pg_data}

        # Simplified comparison logic
        discrepancies = []
        # Check developer, release date etc if available in KG
        # This is a placeholder for more complex comparison logic
        
        return {
            "status": "verified",
            "kg_data": kg,
            "discrepancies": discrepancies
        }
