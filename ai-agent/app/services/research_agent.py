import logging
import json
from typing import Dict, Any, Optional
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)

class ResearchAgent(BaseService, BaseAIClient):
    """
    The Master Researcher.
    Uses GPT-4o Vision and Web Search (tools) to identify games and gather facts.
    """

    async def gather_facts(self, title: str, screenshot_base64: str) -> Dict[str, Any]:
        """
        One-stop-shop for game research.
        """
        self.logger.info(f"Researching: {title}")

        prompt = f"""
        You are a World-Class Game Researcher for ArcadeBox.
        
        Task:
        1. Examine the provided screenshot of the game '{title}'.
        2. USE WEB SEARCH to find the original version of this game (on Poki, CrazyGames, Gamedistribution, etc.).
        3. Extract the EXACT:
            - Controls (Keyboard/Mouse)
            - Game Mechanics/Rules
            - Story/Narrative (if any)
            - Tips for new players
        
        CRITICAL: Ensure the facts match the ARCADE version in the screenshot, NOT a realistic simulation.
        
        Return a comprehensive JSON Fact Sheet:
        {{
            "original_source_url": "string",
            "controls": "string",
            "mechanics": "string",
            "story": "string",
            "tips": ["tip1", "tip2"],
            "visual_style": "string"
        }}
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{screenshot_base64}"
                        }
                    }
                ]
            }
        ]

        # Use the chat_completion helper
        # We assume the user has a model/capability for search enabled
        fact_sheet = await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "original_source_url": "Unknown",
                "controls": "Typical arcade controls (WASD/Mouse)",
                "mechanics": "Fun arcade mechanics",
                "story": "N/A",
                "tips": ["Play carefully"],
                "visual_style": "Arcade"
            }
        )

        self.logger.info(f"Research complete for {title}. Found source: {fact_sheet.get('original_source_url')}")
        return fact_sheet
