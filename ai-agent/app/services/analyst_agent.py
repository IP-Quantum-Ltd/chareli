import logging
from typing import List, Dict, Any
from app.services.base import BaseAIClient, BaseService
from langsmith import traceable

logger = logging.getLogger(__name__)

class AnalystAgent(BaseService, BaseAIClient):
    """
    Stage 1: SEO Intelligence.
    Performs keyword clustering, entity extraction, and intent alignment.
    """

    @traceable(run_type="chain", name="SEO Intelligence Extraction")
    async def analyze_seo_potential(self, game_title: str, verified_facts: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates an SEO blueprint including high-impact keywords and semantic entities.
        """
        self.logger.info(f"Analyst generating SEO intelligence for: {game_title}")

        prompt = f"""
        Task: SEO Strategic Intelligence for the game '{game_title}'.
        Verified Facts from Source: {verified_facts}
        
        Generate a high-impact SEO blueprint for a guide on ArcadeBox.
        
        Focus on:
        1. Primary Keywords (unblocked, highscore, strategy).
        2. Semantic Entities (browser game, casual gaming, specific game mechanics).
        3. Intent Alignment (Tutorial vs Review).
        
        Return ONLY valid JSON:
        {{
            "primary_keywords": ["kw1", "kw2"],
            "semantic_entities": ["entity1", "entity2"],
            "intent_strategy": "string",
            "suggested_title": "string"
        }}
        """

        messages = [
            {"role": "system", "content": "You are a specialized SEO Intelligence Agent for ArcadeBox. Respond only with JSON."},
            {"role": "user", "content": prompt}
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "primary_keywords": [f"{game_title} guide", f"{game_title} unblocked"],
                "semantic_entities": [game_title, "arcade browser game"],
                "intent_strategy": "mastery tutorial",
                "suggested_title": f"The Ultimate {game_title} Mastery Guide"
            }
        )
