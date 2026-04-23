import json
import logging
import httpx
from typing import List, Dict, Any
from app.config import settings
from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)

class AnalystAgent(BaseService, BaseAIClient):
    """
    The Analyst: Bridge between Stage 0 facts and Stage 3 architecture.
    Stages:
    1. SEO Potential Analysis (Internal Facts)
    2. Keyword Intelligence (External SERP via Serper)
    """
    
    def __init__(self):
        super().__init__()
        self.serper_url = "https://google.serper.dev/search"
        self.serper_headers = {
            'X-API-KEY': settings.SERPER_API_KEY,
            'Content-Type': 'application/json'
        }

    async def analyze_seo_potential(self, game_title: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """
        Stage 1: Generates the 'SEO Blueprint' based on extracted librarian facts.
        """
        self.logger.info(f"Analyst generating SEO intelligence for: {game_title}")
        
        prompt = f"""
        You are a Senior SEO Content Analyst. 
        Based on these verified facts about the game '{game_title}', identify the high-value SEO entities and content clusters.
        
        Verified Facts:
        {json.dumps(facts, indent=2)}
        
        Return a JSON response with:
        - "high_value_keywords": list of semantic keywords
        - "intent_classification": string
        - "entity_map": key-value map of main entities
        - "suggested_title": a high-CTR headline
        """
        
        messages = [
            {"role": "system", "content": "You are a professional SEO analyst bot. Return JSON only."},
            {"role": "user", "content": prompt}
        ]
        
        blueprint = await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            metadata={"game": game_title, "stage": "seo_potential"}
        )
        return blueprint if blueprint else {}

    async def analyze_keyword(self, keyword: str) -> Dict[str, Any]:
        """
        Stage 1: SERP Intelligence gathering using Serper (Harriet's Layer).
        """
        self.logger.info(f"Analyst Agent (Serper) starting for keyword: '{keyword}'")
        
        # 1. Search SERP using Serper API
        payload = json.dumps({"q": keyword})
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.serper_url, 
                    headers=self.serper_headers, 
                    data=payload,
                    timeout=20.0
                )
                response.raise_for_status()
                serper_data = response.json()
        except Exception as e:
            self.logger.error(f"Serper search failed: {e}")
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
        
        Return ONLY valid JSON:
        {{
            "intent": "informational" | "transactional",
            "reasoning": "string",
            "required_entities": ["str"],
            "heading_suggestions": ["str"],
            "suggested_faqs": [{{"question": "str", "answer": "str"}}],
            "ground_truth": {{
                "developer": "string",
                "genres": ["str"]
            }}
        }}
        """

        messages = [
            {"role": "system", "content": "You are a professional SEO analyst bot. Return JSON only."},
            {"role": "user", "content": prompt}
        ]

        analysis_result = await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            metadata={"keyword": keyword, "stage": "keyword_intelligence"}
        )
        
        if analysis_result:
            analysis_result["keyword"] = keyword
            return analysis_result
        return {"error": "Intelligence gathering failed"}
