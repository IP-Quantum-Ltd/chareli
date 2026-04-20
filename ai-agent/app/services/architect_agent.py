import logging
from typing import Dict, Any
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)

class ArchitectAgent(BaseService, BaseAIClient):
    """
    Stage 3: Content Architect.
    Designs the high-level plan and structure for the SEO article.
    """

    async def build_outline(self, game_title: str, research_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a structured JSON outline for the game guide.
        """
        self.logger.info(f"Architect designing content plan for: {game_title}")

        prompt = f"""
        Task: Design a Content Plan for a high-ranking SEO guide on '{game_title}'.
        Research Verification: {research_data}
        
        Guidelines:
        1. Optimized for ArcadeBox (Casual/Unblocked market).
        2. Must include specific sections for Controls, Mechanics, and Mastery Tips.
        3. Ensure the structure flows logically from introduction to FAQ.
        
        Return ONLY valid JSON:
        {{
            "sections": [
                {{"title": "Overview", "goals": ["string"]}},
                {{"title": "Controls", "goals": ["string"]}},
                {{"title": "Strategy", "goals": ["string"]}},
                {{"title": "FAQ", "goals": ["string"]}}
            ],
            "estimated_word_count": int,
            "formatting_requirements": ["list"]
        }}
        """

        messages = [
            {"role": "system", "content": "You are a Content Architect specializing in gaming SEO. Respond only with JSON."},
            {"role": "user", "content": prompt}
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "sections": [{"title": "Introduction", "goals": ["Engage user"]}],
                "estimated_word_count": 500,
                "formatting_requirements": ["Use H2 headers"]
            }
        )
