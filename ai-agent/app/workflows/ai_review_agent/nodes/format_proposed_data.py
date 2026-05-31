import json
import logging
from typing import Any, Dict

from app.domain.schemas.llm_outputs import ProposedGameDataOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.workflows.ai_review_agent.context import record_stage
from app.workflows.ai_review_agent.services.faq_generation_service import FaqGenerationService
from app.workflows.ai_review_agent.services.proposal_structure import (
    ArticleSectionExtractor,
    HOW_TO_PLAY_SECTIONS,
)
from app.workflows.ai_review_agent.services.submission_reconciler import SubmissionReconciler
from app.workflows.ai_review_agent.services.trademark_guard import redact_trademarks

logger = logging.getLogger(__name__)


class FormatProposedDataNode:
    """
    Final LLM step: maps pipeline output → server Game schema for proposedData submission.

    Field mapping (verified against client GameInfoSection.tsx):
      description           ← Overview section HTML only
      metadata.howToPlay    ← How to Play + Controls + Strategy sections (concatenated)
      metadata.faqOverride  ← FAQ section HTML, formatted as <h3>+<h4>Q:</h4><p>A:</p>
    """

    def __init__(self, ai: AIExecutor):
        self._ai = ai
        self._submission_reconciler = SubmissionReconciler()
        self._faq_service = FaqGenerationService(min_items=3, max_items=8)

    async def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        game_title = state.get("game_title") or ""
        logger.info("Node: Format | Game: %s | pipeline_status: %s", game_title, state.get("status"))

        article = state.get("article") or ""

        if not article:
            state["proposed_game_data"] = self._build_fallback(state)
            record_stage(state, "format", "completed", "Proposed game data built from fallback (no article available).")
            return state

        grounded = state.get("grounded_context") or {}
        gameplay = (grounded.get("grounded_gameplay") or {})
        seo_support = (grounded.get("seo_support") or {})
        optimization = state.get("optimization") or {}
        investigation = state.get("investigation") or {}
        current_game = ((state.get("proposal_snapshot") or {}).get("game") or {})
        current_metadata = (current_game.get("metadata") or {}) if isinstance(current_game, dict) else {}
        current_seo = (current_game.get("seoMeta") or {}) if isinstance(current_game, dict) else {}
        best_match = (investigation.get("best_match") or {})
        extracted_facts = (best_match.get("extracted_facts") or {})
        best_match_meta = best_match.get("metadata") or {}

        # ------------------------------------------------------------------
        # Step 1: Extract structured sections from the article (deterministic)
        # ------------------------------------------------------------------
        extractor = ArticleSectionExtractor(article)

        description_html = extractor.get_description_html()  # Overview only
        how_to_play_html = extractor.get_how_to_play_html()  # HTP + Controls + Strategy
        raw_faq_html = extractor.get_faq_section()           # reformatted for parseFAQ()

        # ------------------------------------------------------------------
        # Step 2: Build FAQ via FaqGenerationService (de-dup + scoring)
        # ------------------------------------------------------------------
        # Collect the non-FAQ plain text for overlap scoring
        non_faq_content = " ".join([
            extractor.get_section("Overview"),
            extractor.get_section("How to Play"),
            extractor.get_section("Controls"),
            extractor.get_section("Strategy"),
        ])

        # Parse article FAQ items for the service
        article_faq_items = _parse_faq_html(raw_faq_html)

        validated_faq_items = self._faq_service.generate(
            non_faq_content=non_faq_content,
            article_faq_items=article_faq_items,
            optimizer_faq_schema=optimization.get("faq_schema") or [],
            grounded_faq_evidence=(best_match_meta.get("faq_items") or []),
            seo_faq_opportunities=(seo_support.get("faq_opportunities") or []),
        )

        # Reformat validated FAQ back to the parseFAQ-compatible HTML structure
        faq_override_html = _format_faq_html(game_title, validated_faq_items) if validated_faq_items else raw_faq_html

        # ------------------------------------------------------------------
        # Step 3: LLM call — only for metadata fields (title, categoryId, tags, etc.)
        #          NOT for description / howToPlay / faqOverride (extracted above)
        # ------------------------------------------------------------------
        context_summary = {
            "game_title": game_title,
            "objective": gameplay.get("objective") or extracted_facts.get("objective") or "",
            "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or "",
            "features": gameplay.get("features") or [],
            "primary_keywords": seo_support.get("primary_keywords") or [],
            "secondary_keywords": seo_support.get("secondary_keywords") or [],
            "content_angles": seo_support.get("content_angles") or [],
            "meta_description": optimization.get("meta_description") or "",
            "existing_game": {
                "title": current_game.get("title") or "",
                "categoryId": current_game.get("categoryId") or "",
                "metadata": {
                    "features": current_metadata.get("features") or [],
                    "tags": current_metadata.get("tags") or [],
                    "seoKeywords": current_metadata.get("seoKeywords") or "",
                    "developer": current_metadata.get("developer") or "",
                    "platform": current_metadata.get("platform") or [],
                    "releaseDate": current_metadata.get("releaseDate") or "",
                },
            },
        }

        prompt = f"""You are formatting a browser game's metadata for storage.
Game title: {game_title}
Context (JSON):
{json.dumps(context_summary, indent=2, default=str)}

Return ONLY valid JSON:
{{
  "title": "{game_title}",
  "description": "",
  "categoryId": "<preserve existing categoryId exactly when it exists, otherwise empty string>",
  "metadata": {{
    "howToPlay": "",
    "faqOverride": "",
    "features": ["<feature 1>", "<feature 2>", "<feature 3>"],
    "tags": ["<tag1>", "<tag2>", "<tag3>", "<tag4>", "<tag5>"],
    "seoKeywords": "<comma-separated primary and secondary keywords>",
    "developer": "<original developer studio name; empty if unknown or just a hosting domain>",
    "platform": ["Browser"],
    "releaseDate": ""
  }}
}}

Rules:
- description and howToPlay and faqOverride MUST be empty strings — they are handled separately
- features: 3-6 short gameplay feature strings (plain text)
- tags: 4-8 short tags (plain text)
- developer: exact studio/developer name; remove domains like '.com'; if only a low-signal hosting site label, output empty string
- preserve existing_game.categoryId exactly when it exists"""

        try:
            result = await self._ai.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                pydantic_schema=ProposedGameDataOutput,
                fallback_data={
                    "title": game_title,
                    "description": "",
                    "metadata": {
                        "howToPlay": "",
                        "faqOverride": "",
                        "features": gameplay.get("features") or [],
                        "tags": (seo_support.get("primary_keywords") or [])[:6],
                        "seoKeywords": ", ".join((seo_support.get("primary_keywords") or [])[:10]),
                        "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or "",
                        "platform": ["Browser"],
                        "releaseDate": "",
                    },
                },
                metadata={"stage": "format_proposed_data"},
            )
        except Exception as exc:
            logger.warning("FormatProposedData LLM call failed, using fallback: %s", exc)
            result = self._build_fallback(state)

        if not isinstance(result, dict):
            result = {}

        # ------------------------------------------------------------------
        # Step 4: Inject deterministically extracted HTML fields
        # ------------------------------------------------------------------
        # Apply trademark redaction before storing
        result["title"] = game_title
        result["description"] = redact_trademarks(description_html) if description_html else (current_game.get("description") or "")
        if "metadata" not in result or not isinstance(result["metadata"], dict):
            result["metadata"] = {}
        result["metadata"]["howToPlay"] = redact_trademarks(how_to_play_html) if how_to_play_html else (current_metadata.get("howToPlay") or "")
        result["metadata"]["faqOverride"] = redact_trademarks(faq_override_html) if faq_override_html else (current_metadata.get("faqOverride") or "")

        # Preserve categoryId from existing game if LLM blanked it
        if not result.get("categoryId") and current_game.get("categoryId"):
            result["categoryId"] = current_game["categoryId"]

        # ------------------------------------------------------------------
        # Step 5: Reconcile with current game data
        # ------------------------------------------------------------------
        reconciled_game_data, reconciled_seo = self._submission_reconciler.reconcile(
            result,
            state.get("seo_meta") or {},
            current_game,
        )
        state["proposed_game_data"] = reconciled_game_data
        state["seo_meta"] = reconciled_seo
        record_stage(state, "format", "completed", f"Proposed game data formatted for '{game_title}'.")
        return state

    def _build_fallback(self, state: Dict[str, Any]) -> Dict[str, Any]:
        game_title = state.get("game_title") or ""
        article = state.get("article") or ""
        grounded = state.get("grounded_context") or {}
        gameplay = grounded.get("grounded_gameplay") or {}
        seo_support = (grounded.get("seo_support") or {})
        investigation = state.get("investigation") or {}
        current_game = ((state.get("proposal_snapshot") or {}).get("game") or {})
        current_metadata = (current_game.get("metadata") or {}) if isinstance(current_game, dict) else {}
        extracted_facts = ((investigation.get("best_match") or {}).get("extracted_facts") or {})

        # Even in fallback, use section extractor if article is available
        description_html = ""
        how_to_play_html = ""
        faq_html = ""
        if article:
            extractor = ArticleSectionExtractor(article)
            description_html = extractor.get_description_html()
            how_to_play_html = extractor.get_how_to_play_html()
            faq_html = extractor.get_faq_section()

        return {
            "title": game_title,
            "description": redact_trademarks(description_html) or (current_game.get("description") or ""),
            "categoryId": current_game.get("categoryId") or "",
            "metadata": {
                "howToPlay": redact_trademarks(how_to_play_html) or (current_metadata.get("howToPlay") or ""),
                "faqOverride": redact_trademarks(faq_html) or (current_metadata.get("faqOverride") or ""),
                "features": gameplay.get("features") or current_metadata.get("features") or [],
                "tags": (seo_support.get("primary_keywords") or [])[:6] or current_metadata.get("tags") or [],
                "seoKeywords": ", ".join((seo_support.get("primary_keywords") or [])[:10]) or (current_metadata.get("seoKeywords") or ""),
                "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or current_metadata.get("developer") or "",
                "platform": ["Browser"],
                "releaseDate": current_metadata.get("releaseDate") or "",
            },
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_faq_html(faq_html: str) -> list:
    """Parse <h4>Q:…</h4><p>…</p> pairs from formatted FAQ HTML."""
    import re
    if not faq_html:
        return []
    items = []
    pattern = re.compile(r"<h[34][^>]*>Q:\s*(.*?)</h[34]>\s*<p[^>]*>(.*?)</p>", re.IGNORECASE | re.DOTALL)
    for match in pattern.finditer(faq_html):
        q = re.sub(r"<[^>]+>", "", match.group(1)).strip()
        a = re.sub(r"<[^>]+>", "", match.group(2)).strip()
        if q and a:
            items.append({"question": q, "answer": a})
    return items


def _format_faq_html(game_title: str, items: list) -> str:
    """Format FAQ items into <h3>+<h4>Q:</h4><p>A:</p> structure for parseFAQ()."""
    import html
    if not items:
        return ""
    parts = [f"<h3>{html.escape(game_title)} FAQ</h3>"]
    for item in items:
        q = html.escape(str(item.get("question", "")).strip())
        a = html.escape(str(item.get("answer", "")).strip())
        if q and a:
            parts.append(f"<h4>Q: {q}</h4><p>{a}</p>")
    return "\n".join(parts) if len(parts) > 1 else ""
