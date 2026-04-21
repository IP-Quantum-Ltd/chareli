import logging
import asyncio
import base64
import os
from typing import List, Dict, Any
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.services.browser_agent import capture_external_page
from langsmith import traceable

logger = logging.getLogger(__name__)

class VisualLibrarian(BaseService, BaseAIClient):
    """
    Stage 0: Visual Librarian.
    Implements Triple-Image Correlation Analysis using BROWSER-ONLY search (Zero-API).
    """

    def __init__(self):
        super().__init__()
        # Removed TavilyClient initialization

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(self, game_title: str, internal_screenshots: List[str]) -> Dict[str, Any]:
        """
        Executes the Visual Correlation Loop:
        1. Browser-based Search (Zero-API)
        2. Live Content Capturing (5 candidates)
        3. Visual Correlation Scoring (using 2 internal reference images)
        """
        from app.services.browser_agent import search_for_urls
        self.logger.info(f"Visual Librarian initiating zero-API investigation for: {game_title}")

        # 1. Zero-API Browser Search
        search_results = await search_for_urls(game_title, count=5)
        
        if not search_results:
            return {"status": "failed", "reason": "Zero search results found via browser scraper."}

        candidates = []
        
        # 2. Live Content Acquisition (5 candidates)
        for i, url in enumerate(search_results):
            output_path = f"external_candidate_{i}.png"
            
            # Use BrowserAgent to visit and capture (10s wait implemented in capture_external_page)
            captured_path = await capture_external_page(url, output_path)
            
            if captured_path:
                with open(captured_path, "rb") as f:
                    ext_base64 = base64.b64encode(f.read()).decode("utf-8")
                
                # 3. Correlation Analysis (GPT-4o Vision + Dual Internal Reference)
                score_data = await self._calculate_correlation(
                    game_title, 
                    internal_screenshots, 
                    ext_base64,
                    url
                )
                
                candidates.append({
                    "url": url,
                    "confidence_score": score_data.get("confidence_score", 0),
                    "reasoning": score_data.get("reasoning", "Unknown"),
                    "extracted_facts": score_data.get("facts", {})
                })
                
                # Cleanup temporal files
                if os.path.exists(output_path): os.remove(output_path)

        # Selection (Best Visual Match)
        if not candidates:
            return {"status": "failed", "reason": "No valid external matches captured."}
            
        best_match = max(candidates, key=lambda x: x["confidence_score"])
        
        # Optional Deep Extraction for the Winner
        best_match["deep_research_results"] = {}
        if best_match["confidence_score"] > 80:
            self.logger.info(f"High confidence match ({best_match['confidence_score']}%). Performing deep content grab...")
            deep_info = await self._extract_deep_content(best_match["url"])
            if deep_info and isinstance(deep_info, dict):
                best_match["deep_research_results"] = deep_info
                best_match["extracted_facts"].update(deep_info)

        self.logger.info(f"Investigation complete. Best match found at {best_match['url']} with {best_match['confidence_score']}% confidence.")
        
        return {
            "status": "success",
            "best_match": best_match,
            "all_candidates": candidates
        }

    async def _calculate_correlation(self, title: str, internal_imgs: List[str], external_img: str, url: str) -> Dict[str, Any]:
        """
        Uses GPT-4o Vision to perform the 'Triple-Image Correlation Analysis'.
        Compares TWO internal gameplay frames vs the external web page content.
        """
        prompt = f"""
        Task: Triple-Image Correlation Analysis (Grounded Verification).
        You are an Autonomous Content Verifier. Compare the provided images to determine if they represent the same game: '{title}'.
        
        Reference Materials:
        - Internal Frame A: Initial gameplay/menu state.
        - Internal Frame B: Advanced gameplay state (taken 5s after A).
        - External Candidate: A webpage found at {url}.
        
        Mission:
        Identify if 'External Candidate' is the official version or a highly accurate distribution page for the same game seen in Frames A & B.
        
        Evaluation Criteria:
        1. Character/Asset Consistency (Are the sprites/models identical?).
        2. UI/UX Signature (Buttons, HUD, font styles).
        3. Mechanic Matching (Do the instructions on the web match the gameplay scene?).
        
        Return ONLY valid JSON:
        {{
            "confidence_score": int (0-100),
            "reasoning": "detailed explanation comparing all 3 images",
            "facts": {{
                "controls": "string",
                "rules": "string",
                "original_developer": "string"
            }}
        }}
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{internal_imgs[0]}"}
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{internal_imgs[1]}"}
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{external_img}"}
                    }
                ]
            }
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={"confidence_score": 0, "reasoning": "Correlation check failed."},
            metadata={"source_url": url}
        )


    async def _extract_deep_content(self, url: str) -> Dict[str, Any]:
        """Performs a second, deep pass on the winner to extract granular SEO entities."""
        from app.services.browser_agent import capture_external_page
        
        output_path = "deep_research_capture.png"
        captured_path = await capture_external_page(url, output_path) 
        
        if not captured_path:
            return {}

        with open(captured_path, "rb") as f:
            screenshot_base64 = base64.b64encode(f.read()).decode("utf-8")
        
        prompt = f"""
        Analyze this game page screenshot from {url}.
        Extract EXACT details for:
        - How to Play / Instructions
        - Key Game Controls (Keyboard, Mouse, Touch)
        - Unique Features or Modes
        
        Return a JSON object with these fields.
        """
        
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{screenshot_base64}"}
                    }
                ]
            }
        ]
        
        res = await self.chat_completion(
            messages=messages, 
            response_format={"type": "json_object"},
            metadata={"source_url": url, "mode": "deep_research"}
        )
        
        # Cleanup
        if os.path.exists(output_path): os.remove(output_path)
        
        return res if res else {}
