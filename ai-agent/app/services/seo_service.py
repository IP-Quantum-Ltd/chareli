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
        Main analysis pipeline for a seed keyword.
        1. Research the keyword on the web.
        2. Use LLM to extract intent and required entities.
        """
        logger.info(f"Analyzing search intelligence for keyword: {keyword}")

        # 1. Get search context
        search_results = await self.search.universal_search(f"Top ranking content for {keyword}")
        context = "\n".join([f"- {r['title']}: {r['content']}" for r in search_results])

        # 2. Analyze with LLM
        prompt = f"""
        Analyze the following search context for the keyword: '{keyword}'
        
        Search Context:
        {context}
        
        Goal: Identify what Google expects from a high-ranking page for this keyword.
        
        Return a JSON object with:
        1. "intent": The search intent (Informational, Transactional, Navigational).
        2. "required_entities": A list of specific topics, entities, or features that must be covered.
        3. "content_gaps": Potential areas where current results are weak.
        4. "suggested_structure": A high-level outline (H2/H3 ideas).
        
        Output MUST be pure JSON.
        """

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o", # Using 4o for better reasoning
                messages=[
                    {"role": "system", "content": "You are a senior SEO strategist. Respond only with JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            analysis = json.loads(response.choices[0].message.content)
            return analysis
            
        except Exception as e:
            logger.error(f"SEO Analysis failed: {e}")
            return {
                "intent": "Unknown",
                "required_entities": [],
                "content_gaps": [],
                "suggested_structure": []
            }
