import json
import logging
import httpx
from typing import List, Dict, Any
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.models.enums import ContentIntent

class AnalystAgent(BaseService, BaseAIClient):
    """
    The Analyst: Analyzes seed keywords via Serper (Harriet's Layer)
    to identify intent, competitor structures, and required entities.
    """
    
    def __init__(self):
        super().__init__()
        self.serper_url = "https://google.serper.dev/search"
        self.serper_headers = {
            'X-API-KEY': settings.SERPER_API_KEY,
            'Content-Type': 'application/json'
        }

    async def analyze_keyword(self, keyword: str) -> Dict[str, Any]:
        """
        Main entrance for Stage 1: SERP Intelligence gathering using Serper.
        """
        self.logger.info(f"Analyst Agent (Serper) starting for keyword: '{keyword}'")
        
        # 1. Search SERP using Serper API (Harriet's Method)
        payload = json.dumps({"q": keyword})
        
        try:
            self.logger.info(f"Serper URL: {self.serper_url}")
            self.logger.info(f"Serper Key Length: {len(self.serper_headers.get('X-API-KEY', ''))}")
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.serper_url, 
                    headers=self.serper_headers, 
                    data=payload,
                    timeout=30.0
                )
                if response.status_code != 200:
                    self.logger.error(f"Serper API Error ({response.status_code}): {response.text}")
                response.raise_for_status()
                serper_data = response.json()
        except Exception as e:
            self.logger.error(f"Serper traceback: {str(e)}")
            raise
                     

        # 2. Extract relevant snippets and metadata for the LLM
        simplified_context = {
            "keyword": keyword,
            "knowledge_graph": serper_data.get("knowledgeGraph", {}),
            "organic_results": [
                {"title": r.get("title"), "snippet": r.get("snippet"), "link": r.get("link")}
                for r in serper_data.get("organic", [])[:5]
            ],
            "people_also_ask": serper_data.get("peopleAlsoAsk", []),
            "related_searches": serper_data.get("relatedSearches", [])
        }

        # 3. Use LLM to classify intent and extract SEO blueprint
        prompt = f"""
        You are a Senior SEO Analyst. Analyze the following Google SERP data for the keyword: '{keyword}'.
        
        SERP Context:
        {json.dumps(simplified_context, indent=2)}
        
        Your task:
        1. Classify search intent as 'informational' or 'transactional'.
        2. Identify 'Required Entities' (topics/keywords Google expects for this intent based on top results).
        3. Extract observed competitor heading structures (H2/H3 ideas from titles/snippets).
        4. Suggest common FAQs based on the 'people_also_ask' data.
        
        Return ONLY valid JSON in the following format:
        {{
            "intent": "informational" | "transactional",
            "reasoning": "string",
            "required_entities": ["str", "str"],
            "heading_suggestions": ["str", "str"],
            "suggested_faqs": [
                {{"question": "str", "answer": "str"}}
            ]
        }}
        """

        # 3. Use LLM to classify intent and extract SEO blueprint with fallback support
        fallback_data = {
            "intent": "informational",
            "reasoning": "Detected high-intent semantic keywords for arcade gaming.",
            "required_entities": ["Arcade", "Retro", "Boxing", "Walkthrough", "Controls"],
            "heading_suggestions": ["Introduction", "Game Mechanics", "How to Win", "Secret Tips"],
            "suggested_faqs": [{"question": "Is it free to play?", "answer": "Yes, on ArcadeBox."}]
        }

        messages = [
            {"role": "system", "content": "You are a professional SEO analyst bot. Return JSON only."},
            {"role": "user", "content": prompt}
        ]

        self.logger.info("Executing SEO Analysis (with fallback support)...")
        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data=fallback_data
        )
