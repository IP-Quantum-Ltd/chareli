import json
import logging
from typing import List, Dict, Any
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)

class ArchitectAgent(BaseService, BaseAIClient):
    """
    Stage 3: The Architect.
    Builds the content blueprint and retrieval strategy for the Scribe.
    """

    async def build_outline(self, game_title: str, seo_intel: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a structured outline and mapping for RAG retrieval.
        """
        self.logger.info(f"Architect designing outline for: {game_title}")

        prompt = f"""
        You are a Content Architect. Your goal is to design a high-ranking article outline for the game '{game_title}'.
        
        SEO Intelligence:
        {json.dumps(seo_intel, indent=2)}
        
        Task:
        1. Design a Table of Contents (H2 and H3).
        2. For EACH section, define a 'Retrieval Query' that we will use to find the best facts in our MongoDB Knowledge Hub.
        3. Ensure the structure satisfies the 'Required Entities' and 'Suggested FAQs' from the SEO intel.
        
        Return ONLY valid JSON in this format:
        {{
            "title_proposal": "string",
            "outline": [
                {{
                    "heading": "string",
                    "level": 2,
                    "retrieval_query": "string (what to search in vector DB for this section)",
                    "objective": "string"
                }}
            ]
        }}
        """

        messages = [
            {"role": "system", "content": "You are a professional Content Architect. Respond only with JSON."},
            {"role": "user", "content": prompt}
        ]

        # Use the chat_completion helper from BaseAIClient
        outline = await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "title_proposal": f"Ultimate Guide to {game_title}",
                "outline": [
                    {"heading": "Introduction", "level": 2, "retrieval_query": f"{game_title} gameplay overview", "objective": "Hook the reader."},
                    {"heading": "How to Play", "level": 2, "retrieval_query": f"{game_title} controls and mechanics", "objective": "Explain the rules."}
                ]
            }
        )

        self.logger.info(f"Outline complete with {len(outline.get('outline', []))} sections.")
        return outline
