import json
import logging
from typing import Any, Dict, List

from app.infrastructure.llm.ai_executor import AIExecutor

logger = logging.getLogger(__name__)


class VisualSearchService:
    def __init__(self, ai: AIExecutor):
        self._ai = ai

    async def search_candidates(self, title: str, internal_images: List[str], search_query: str, exact_identity: Dict[str, Any], count: int = 10) -> Dict[str, Any]:
        exact_title = str(exact_identity.get("exact_game_name") or "").strip() or title
        aliases = [item for item in (exact_identity.get("aliases") or []) if isinstance(item, str)]
        distinguishing_features = [item for item in (exact_identity.get("distinguishing_features") or []) if isinstance(item, str)]
        avoid_titles = [item for item in (exact_identity.get("avoid_titles") or []) if isinstance(item, str)]
        prompt = f"""
        You are finding the exact playable browser-game pages for Stage 0 verification.
        Database title: {title}
        Most likely exact game name: {exact_title}
        Allowed same-game aliases: {aliases}
        Distinguishing features: {distinguishing_features}
        Avoid mismatching to these generic or wrong titles: {avoid_titles}
        Search query hint: {search_query}
        Return ONLY valid JSON:
        {{"candidates": [{{"url": "https://example.com/game-page", "title": "Page title", "reason": "short reason"}}]}}
        """
        try:
            response = await self._ai.openai_client.responses.create(
                model=self._ai.llm_config.web_search_model,
                reasoning={"effort": "low"},
                tools=[{"type": "web_search"}],
                tool_choice="auto",
                include=["web_search_call.action.sources"],
                input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}, {"type": "input_image", "image_url": f"data:image/png;base64,{internal_images[0]}"}, {"type": "input_image", "image_url": f"data:image/png;base64,{internal_images[1]}"}]}],
            )
            raw_output_text = getattr(response, "output_text", "") or ""
            parsed = self._parse_json_text(raw_output_text, {"candidates": []})
            sources = self._extract_web_search_sources(response)
            candidates = self._normalize_web_candidates(parsed.get("candidates") or [], sources, count=count)
            return {"engine": "openai_responses_web_search", "model": self._ai.llm_config.web_search_model, "query": search_query, "candidates": candidates, "sources": sources, "raw_output_text": raw_output_text}
        except Exception as exc:
            logger.error("OpenAI web search failed for '%s': %s", title, exc)
            return {"engine": "openai_responses_web_search", "model": self._ai.llm_config.web_search_model, "query": search_query, "candidates": [], "sources": [], "error": str(exc)}

    def _parse_json_text(self, raw_text: str, fallback_data: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = (raw_text or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else fallback_data
        except Exception:
            return fallback_data

    def _extract_web_search_sources(self, response: Any) -> List[Dict[str, str]]:
        try:
            payload = response.model_dump()
        except Exception:
            return []
        discovered: List[Dict[str, str]] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                url = node.get("url")
                title = node.get("title") or node.get("site_name") or node.get("name") or ""
                if isinstance(url, str) and url.startswith("http"):
                    discovered.append({"url": url, "title": str(title)})
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(payload)
        deduped = []
        seen = set()
        for item in discovered:
            url = item["url"].strip()
            if not url or url in seen:
                continue
            seen.add(url)
            deduped.append({"url": url, "title": item.get("title", "").strip()})
        return deduped

    def _normalize_web_candidates(self, model_candidates: List[Dict[str, Any]], sources: List[Dict[str, str]], count: int = 10) -> List[Dict[str, str]]:
        normalized = []
        seen = set()
        blocked_fragments = ["play.google.com", "apps.apple.com", "/store/apps/", "microsoft.com", "steamcommunity.com", "store.steampowered.com", "youtube.com", "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "pinterest.com", "/tag/", "/category/"]

        def allowed(url: str) -> bool:
            lowered_url = url.lower()
            return url.startswith("http") and not any(fragment in lowered_url for fragment in blocked_fragments)

        for candidate in model_candidates:
            if not isinstance(candidate, dict):
                continue
            url = str(candidate.get("url", "")).strip()
            if not allowed(url) or url in seen:
                continue
            seen.add(url)
            normalized.append({"url": url, "title": str(candidate.get("title", "")).strip(), "reason": str(candidate.get("reason", "")).strip()})
            if len(normalized) >= count:
                return normalized

        for source in sources:
            url = str(source.get("url", "")).strip()
            if not allowed(url) or url in seen:
                continue
            seen.add(url)
            normalized.append({"url": url, "title": str(source.get("title", "")).strip(), "reason": "Recovered from OpenAI web search source list."})
            if len(normalized) >= count:
                break
        return normalized
