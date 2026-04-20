import logging
import asyncio
import base64
import os
from typing import List, Dict, Any
from tavily import TavilyClient
from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.services.browser_agent import capture_external_page

logger = logging.getLogger(__name__)

class VisualLibrarian(BaseService, BaseAIClient):
    """
    Stage 0: Visual Librarian.
    Implements Triple-Image Correlation Analysis as defined in the updated 14-Day Scope.
    """

    def __init__(self):
        super().__init__()
        self.tavily = TavilyClient(api_key=settings.TAVILY_API_KEY)

    async def verify_and_research(self, game_title: str, internal_screenshot_base64: str) -> Dict[str, Any]:
        """
        Executes the Visual Correlation Loop:
        1. Multi-source Search
        2. Live Content Capturing
        3. Visual Correlation Scoring
        """
        self.logger.info(f"Visual Librarian initiating investigation for: {game_title}")

        # 1. Image-Weighted Search (Multi-source)
        search_query = f"{game_title} arcade browser game play online"
        search_results = await self._get_candidate_urls(search_query)
        
        candidates = []
        
        # 2. Live Content Acquisition (Recursive Capturing)
        # Limit to Top 3 for efficiency in this sprint, but scalable to 5
        for i, result in enumerate(search_results[:3]):
            url = result["url"]
            output_path = f"external_candidate_{i}.png"
            
            # Use BrowserAgent to visit and capture
            captured_path = await capture_external_page(url, output_path)
            
            if captured_path:
                with open(captured_path, "rb") as f:
                    ext_base64 = base64.b64encode(f.read()).decode("utf-8")
                
                # 3. Correlation Analysis (GPT-4o Vision + Tracing)
                score_data = await self._calculate_correlation(
                    game_title, 
                    internal_screenshot_base64, 
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

        # 4. Selection (Best Visual Match)
        if not candidates:
            return {"status": "failed", "reason": "No valid external matches found."}
            
        best_match = max(candidates, key=lambda x: x["confidence_score"])
        
        # 5. Optional Deep Extraction for the Winner
        best_match["deep_research_results"] = {} # Initialize
        if best_match["confidence_score"] > 80:
            self.logger.info(f"High confidence match ({best_match['confidence_score']}%). Performing deep content grab...")
            deep_info = await self._extract_deep_content(best_match["url"])
            if deep_info and isinstance(deep_info, dict):
                best_match["deep_research_results"] = deep_info
                # Also merge into facts for backward compatibility with Analyst/Scribe
                best_match["extracted_facts"].update(deep_info)

        self.logger.info(f"Investigation complete. Best match found at {best_match['url']} with {best_match['confidence_score']}% confidence.")
        
        return {
            "status": "success",
            "best_match": best_match,
            "all_candidates": candidates
        }

    async def _get_candidate_urls(self, query: str) -> List[Dict[str, str]]:
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, 
            lambda: self.tavily.search(query=query, search_depth="advanced", max_results=5)
        )
        return results.get("results", [])

    async def _calculate_correlation(self, title: str, internal_img: str, external_img: str, url: str) -> Dict[str, Any]:
        """
        Uses GPT-4o Vision to perform the 'Triple-Image Correlation Analysis'.
        Compares the internal gameplay vs the external web page content.
        """
        prompt = f"""
        Task: Triple-Image Correlation Analysis.
        You are an Autonomous Content Verifier. Compare these two images to determine if they represent the same game: '{title}'.
        
        Image 1: Internal Gameplay (Reference)
        Image 2: External Web Page (Search Result from {url})
        
        Evaluation Criteria:
        1. UI Consistency (Icons, buttons, HUD).
        2. Art Style (Assets, characters, color palette).
        3. Branding (Is this the official distribution page or a wiki?).
        
        Return ONLY valid JSON:
        {{
            "confidence_score": int (0-100),
            "reasoning": "brief explanation",
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
                        "image_url": {"url": f"data:image/png;base64,{internal_img}"}
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
