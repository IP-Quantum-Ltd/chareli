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
    Optimized Precision Mode: Saves the prize-winning screenshot to avoid double-visiting URLs.
    """

    def __init__(self):
        super().__init__()
        self.tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY", ""))
        self.mode = settings.LIBRARIAN_MODE

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(
        self, 
        game_id: str, 
        game_title: str, 
        internal_screenshots: List[str]
    ) -> Dict[str, Any]:
        self.logger.info(f"Visual Librarian initiating {self.mode} investigation for: {game_title}")

        if not internal_screenshots:
            return {"status": "failed", "reason": "No internal reference images."}

        reference_img = internal_screenshots[-1]

        # 1. Search Logic
        search_query = f"{game_title} arcade browser game play online"
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
        candidates_to_verify = raw_candidates[:3] # Focus on top 3 for precision

        # 3. Correlation Loop
        candidates = []
        external_dir = Path(__file__).resolve().parents[2] / "stage0_artifacts" / game_id / "external"
        external_dir.mkdir(parents=True, exist_ok=True)
        
        for i, result in enumerate(candidates_to_verify):
            url = result["url"]
            output_path = external_dir / f"candidate_{i}.png"
            
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
                    "base64": ext_base64, # Save for deep extraction
                    "screenshot_path": str(output_path)
                })

        if not candidates:
            return {"status": "failed", "reason": "No valid external matches found."}
            
        best_match = max(candidates, key=lambda x: x["confidence_score"])
        
        # 4. Optional Deep Extraction (REUSES the existing screenshot to avoid double-visit)
        best_match["deep_research_results"] = {} 
        if best_match["confidence_score"] > 75:
            self.logger.info(f"High confidence match ({best_match['confidence_score']}%). Performing deep content grab...")
            deep_info = await self._extract_deep_content_from_image(best_match["url"], best_match["base64"])
            if deep_info:
                best_match["deep_research_results"] = deep_info
                best_match["extracted_facts"].update(deep_info)

        # Cleanup bulky base64s before returning to avoid state bloat
        for c in candidates:
            if "base64" in c: del c["base64"]

        return {
            "status": "success",
            "best_match": best_match,
            "all_candidates": candidates,
            "mode": self.mode
        }

    async def _get_candidate_urls(self, query: str) -> List[Dict[str, str]]:
        import asyncio
        loop = asyncio.get_event_loop()
        try:
            results = await loop.run_in_executor(
                None, 
                lambda: self.tavily.search(query=query, search_depth="advanced", max_results=5)
            )
            return results.get("results", [])
        except: return []

    async def _calculate_correlation(self, title, internal_img, external_img, url):
        prompt = f"""
        Task: Triple-Image Correlation Analysis for '{title}' at {url}.
        Compare the internal reference image against this external web page.
        Analyze UI consistency, art style, and branding assets to determine if they are the same game.
        
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
        return await self.chat_completion(messages=messages, response_format={"type": "json_object"})

    async def _extract_deep_content_from_image(self, url: str, base64_img: str) -> Dict[str, Any]:
        """Performs deep pass on existing screenshot to avoid double-visiting the URL."""
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
        res = await self.chat_completion(messages=messages, response_format={"type": "json_object"})
        return res if res else {}
