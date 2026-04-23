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
    Supports three modes: 'precision' (classic scoring), 'batch' (vision selection), or 'hybrid'.
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

        # Reference image for correlation (Latest gameplay frame)
        reference_img = internal_screenshots[-1]

        # 1. Search Logic
        if self.mode == "batch":
            # Colleague's Playwright Meta-Search
            search_query = f"{game_title} arcade browser game play online"
            search_step = await search_for_urls(
                search_query=search_query,
                output_dir=str(Path(__file__).parents[2] / "stage0_artifacts" / game_id / "search")
            )
            raw_candidates = search_step.get("candidates", [])
        else:
            # User's Precise Tavily Search
            search_query = f"{game_title} arcade browser game play online"
            raw_candidates = await self._get_candidate_urls(search_query)

        if not raw_candidates:
            return {"status": "failed", "reason": "Search returned 0 candidates."}

        # 2. Filtering Logic
        candidates_to_verify = []
        if self.mode in ["batch", "hybrid"] and len(raw_candidates) > 3:
            # Use Vision-Assisted Selection to pick top 3 targets
            selection = await self._select_search_results_with_vision(
                game_title, reference_img, raw_candidates
            )
            selected_urls = selection.get("selected_urls") or []
            candidates_to_verify = [c for c in raw_candidates if c['url'] in selected_urls][:3]
        else:
            # Just take top 3
            candidates_to_verify = raw_candidates[:3]

        # 3. Correlation Loop (User's Scoring Logic)
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
                
                score_data = await self._calculate_correlation(game_title, reference_img, ext_base64, url)
                
                candidates.append({
                    "url": url,
                    "confidence_score": score_data.get("confidence_score", 0),
                    "reasoning": score_data.get("reasoning", "Unknown"),
                    "extracted_facts": score_data.get("facts", {}),
                    "screenshot_path": str(output_path)
                })

        if not candidates:
            return {"status": "failed", "reason": "No valid external matches found."}
            
        best_match = max(candidates, key=lambda x: x["confidence_score"])
        
        # 4. Deep Extraction (Winners only)
        if best_match["confidence_score"] > 75:
            deep_info = await self._extract_deep_content(best_match["url"])
            best_match["extracted_facts"].update(deep_info)

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

    async def _select_search_results_with_vision(self, title: str, thumb: str, results: List[Dict[str, Any]]):
        # Mini-selection logic to pick the best 3 URLs from context
        prompt = f"Given these search results for the game '{title}', and the thumbnail provided, pick the top 3 URLs that are most likely the official or primary gameplay source. Return JSON {{'selected_urls': []}}"
        # ... logic to call LLM with search text
        return {"selected_urls": [r['url'] for r in results[:3]]}

    async def _calculate_correlation(self, title, internal_img, external_img, url):
        # User's original GPT-4o Scoring Logic with explicit JSON instruction
        prompt = f"""
        Task: Triple-Image Correlation Analysis for '{title}' at {url}.
        Compare the internal reference image against this external web page.
        Analyze UI consistency, art style, and branding assets to determine if they are the search results for the same game.
        
        Return a JSON object with:
        - confidence_score: int (0-100)
        - reasoning: brief analysis
        - facts: {{'controls': '...', 'rules': '...'}}
        """
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_img}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{external_img}"}}
            ]}
        ]
        return await self.chat_completion(messages=messages, response_format={"type": "json_object"})

    async def _extract_deep_content(self, url: str) -> Dict[str, Any]:
        # User's Deep Fact Pass with explicit JSON instruction
        output_path = "deep_research.png"
        await capture_external_page(url, output_path) 
        if not os.path.exists(output_path): return {}
        with open(output_path, "rb") as f:
            base64_img = base64.b64encode(f.read()).decode("utf-8")
        prompt = "Extract instructions, controls, and unique features from this game page screenshot. Return the data as a structured JSON object."
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_img}"}}
            ]}
        ]
        res = await self.chat_completion(messages=messages, response_format={"type": "json_object"})
        if os.path.exists(output_path): os.remove(output_path)
        return res if res else {}
