import logging
import json
from typing import Dict, Any
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)

class ScribeAgent(BaseService, BaseAIClient):
    """
    Stage 5: The Scribe.
    Drafts the final article using the Fact Sheet from the Research Agent.
    """

    async def draft_from_facts(self, game_title: str, fact_sheet: Dict[str, Any]) -> str:
        """
        Drafts a full, SEO-optimized article based on the research fact sheet.
        """
        self.logger.info(f"Scribe drafting article for: {game_title}")

        prompt = f"""
        Task: Write a highly engaging, SEO-optimized guide for the game '{game_title}' on ArcadeBox.
        
        Fact Sheet (The Ground Truth):
        {json.dumps(fact_sheet, indent=2)}
        
        Guidelines:
        - Target Platform: ArcadeBox (Hyper-casual browser gaming).
        - Format: Professional Markdown.
        - Tone: Fun, helpful, and energetic.
        - Use these headers (or similar):
            1. Overview
            2. How to Play (Controls & Mechanics)
            3. Story/Background (if applicable)
            4. Pro Tips & Tricks
            5. Conclusion
        
        Focus on 'Saturation': Use keywords like 'unblocked', 'online', 'browser game', 'tips'.
        
        Return the full Markdown article.
        """

        messages = [
            {"role": "system", "content": "You are a professional Content Creator for ArcadeBox. Respond with high-quality Markdown."},
            {"role": "user", "content": prompt}
        ]

        # Use the chat_completion helper
        article = await self.chat_completion(
            messages=messages,
            fallback_data=f"# {game_title} Guide\n\n[Drafting failed. Research data missing.]"
        )

        return article
