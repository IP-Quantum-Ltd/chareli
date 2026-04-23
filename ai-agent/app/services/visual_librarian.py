import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List
from tavily import TavilyClient

from langsmith import traceable
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.services.browser_agent import capture_external_page, search_for_urls

logger = logging.getLogger(__name__)

class VisualLibrarian(BaseService, BaseAIClient):
    """
    Stage 0: Visual Librarian.
    Implements Sequential Correlation Analysis to minimize system resource usage.
    """

    def __init__(self):
        super().__init__()
        self.tavily = TavilyClient(api_key=settings.TAVILY_API_KEY)
        self.mode = settings.LIBRARIAN_MODE

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(
        self, 
        game_id: str, 
        game_title: str, 
        internal_screenshots: List[str],
        max_candidates: int = 3
    ) -> Dict[str, Any]:
        self.logger.info(f"Visual Librarian initiating sequential {self.mode} investigation for: {game_title}")

        if not internal_screenshots:
            return {"status": "failed", "reason": "No internal reference images."}

        reference_img = internal_screenshots[-1]

        # 1. Search Logic
        # Loosened query for better coverage on common games
        search_query = f"{game_title} game play online"
        if self.mode == "batch":
            search_step = await search_for_urls(
                search_query=search_query,
                output_dir=str(Path(__file__).parents[2] / "stage0_artifacts" / game_id / "search")
            )
            raw_candidates = search_step.get("candidates", [])
        else:
            raw_candidates = await self._get_candidate_urls(search_query)

        if not raw_candidates:
            return {"status": "failed", "reason": "Search returned 0 candidates."}

        # 2. Candidate Selection
        candidates_to_verify = raw_candidates[:max_candidates]

        # 3. Sequential Investigation Loop (Resource Friendly)
        external_dir = Path(__file__).resolve().parents[2] / "stage0_artifacts" / game_id / "external"
        external_dir.mkdir(parents=True, exist_ok=True)
        
        candidates = []
        for i, result in enumerate(candidates_to_verify):
            url = result["url"]
            output_path = external_dir / f"candidate_{i}.png"
            self.logger.info(f"Investigating candidate {i+1}/{len(candidates_to_verify)}: {url}")
            
            try:
                capture_data = await capture_external_page(url, str(output_path))
                if capture_data and os.path.exists(output_path):
                    with open(output_path, "rb") as f:
                        ext_base64 = base64.b64encode(f.read()).decode("utf-8")
                    
                    # Perform Triple-Image Correlation
                    score_data = await self._calculate_correlation(game_title, reference_img, ext_base64, url)
                    
                    candidates.append({
                        "url": url,
                        "confidence_score": score_data.get("confidence_score", 0),
                        "reasoning": score_data.get("reasoning", "Unknown"),
                        "extracted_facts": score_data.get("facts", {}),
                        "base64": ext_base64,
                        "screenshot_path": str(output_path)
                    })
            except Exception as e:
                self.logger.error(f"Failed to investigate {url}: {e}")

        if not candidates:
            return {"status": "failed", "reason": "No valid external matches found."}
            
        best_match = max(candidates, key=lambda x: x["confidence_score"])
        
        # 4. Deep Extraction (REUSES the existing screenshot)
        best_match["deep_research_results"] = {} 
        if best_match["confidence_score"] > 75:
            self.logger.info(f"High confidence match ({best_match['confidence_score']}%). Performing deep content grab...")
            deep_info = await self._extract_deep_content_from_image(best_match["url"], best_match["base64"])
            if deep_info:
                best_match["deep_research_results"] = deep_info
                best_match["extracted_facts"].update(deep_info)

        # Cleanup bulky base64s
        for c in candidates:
            if "base64" in c: del c["base64"]

        return {
            "status": "success",
            "best_match": best_match,
            "all_candidates": candidates,
            "mode": self.mode
        }

    async def _get_candidate_urls(self, query: str) -> List[Dict[str, str]]:
        loop = asyncio.get_event_loop()
        try:
            self.logger.info(f"Searching for candidates via Tavily: {query}")
            results = await loop.run_in_executor(
                None, 
                lambda: self.tavily.search(query=query, search_depth="advanced", max_results=5)
            )
            raw_results = results.get("results", [])
            self.logger.info(f"Tavily returned {len(raw_results)} results.")
            return raw_results
        except Exception as e: 
            self.logger.error(f"Tavily search failed: {e}")
            return []

    async def _calculate_correlation(self, title, internal_img, external_img, url):
        prompt = f"""
        Task: Triple-Image Correlation Analysis for '{title}' at {url}.
        Compare the internal reference image against this external web page.
        Analyze UI consistency, art style, and branding assets to determine if they represent the same game.
        
        CRITICAL RULE: If the external image is a solid color, a blank 'grey box', a login wall, or a generic connection error, you MUST return a confidence_score of 0.
        
        However, if the image shows a BRANDED SPLASH SCREEN, a LOADING BAR with the game's logo, or recognisable ART belonging to the game, you SHOULD return a positive confidence score based on the visual match, even if the active gameplay hasn't rendered yet.
        
        Return a JSON object with:
        {{
            "confidence_score": int (0-100),
            "reasoning": "string",
            "facts": {{
                "controls": "string",
                "rules": "string",
                "original_developer": "string"
            }}
        }}
        """
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_img}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{external_img}"}}
            ]}
        ]
        return await self.chat_completion(
            messages=messages, 
            response_format={"type": "json_object"},
            fallback_data={"confidence_score": 0, "reasoning": "Vision pass failed or returned empty content.", "facts": {}}
        )

    async def _extract_deep_content_from_image(self, url: str, base64_img: str) -> Dict[str, Any]:
        prompt = f"""
        Analyze this game page screenshot from {url}.
        Extract EXACT factual details for:
        - How to Play / Instructions
        - Key Game Controls (Keyboard, Mouse, Touch)
        - Unique Features, Modes or Power-ups
        
        Return as a structured JSON object.
        """
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_img}"}}
            ]}
        ]
        res = await self.chat_completion(
            messages=messages, 
            response_format={"type": "json_object"},
            fallback_data={"instructions": "None", "controls": "None", "features": []}
        )
        return res if res else {}
