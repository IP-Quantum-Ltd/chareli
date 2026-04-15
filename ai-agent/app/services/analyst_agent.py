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

        self.logger.info("Sending Serper data to OpenAI for SEO Blueprint extraction...")
        
        # Mock fallback for testing
        if not self.api_key or "sk-" not in self.api_key or "dummy" in self.api_key.lower():
            self.logger.warning("Using mock SEO analysis due to dummy API key.")
            return {
                "intent": "informational",
                "reasoning": "This is a mock response because a dummy API key was detected.",
                "required_entities": ["Arcade Games", "Retro Gaming", "Boxing", "Multiplayer"],
                "heading_suggestions": ["History of Arcade Boxing", "Top 10 Retro Hits", "How to Play"],
                "suggested_faqs": [{"question": "What is the best boxing game?", "answer": "Mike Tyson's Punch-Out!!"}]
            }

        try:
            llm_response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a professional SEO analyst bot. Return JSON only."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            analysis_result = json.loads(llm_response.choices[0].message.content)
            self.logger.info(f"Analysis complete. Intent: {analysis_result.get('intent')}")
            return analysis_result
            
        except Exception as e:
            self.logger.error(f"LLM analysis failed: {e}")
            raise
