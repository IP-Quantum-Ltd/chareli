import logging
from typing import Any, Dict, List

from langsmith import traceable

from app.domain.schemas.llm_outputs import AuditReportOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm

logger = logging.getLogger(__name__)


class ContentAuditorService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0

    def _flatten_evidence(self, grounded_context: Dict[str, Any], investigation: Dict[str, Any]) -> List[str]:
        packet = grounded_context.get("grounded_packet") or {}
        best_match = investigation.get("best_match") or {}
        candidates = []
        for value in [
            packet.get("canonical_identity"),
            packet.get("grounded_gameplay"),
            packet.get("seo_support"),
            best_match.get("extracted_facts"),
            (best_match.get("metadata") or {}).get("title"),
            (best_match.get("metadata") or {}).get("meta_description"),
        ]:
            if isinstance(value, dict):
                candidates.extend(str(item).strip() for item in value.values() if str(item).strip())
            elif isinstance(value, list):
                candidates.extend(str(item).strip() for item in value if str(item).strip())
            elif value:
                candidates.append(str(value).strip())
        return candidates

    def _fallback_audit(self, article: str, grounded_context: Dict[str, Any], investigation: Dict[str, Any]) -> Dict[str, Any]:
        evidence = self._flatten_evidence(grounded_context, investigation)
        article_lower = (article or "").lower()
        matched = [item for item in evidence[:20] if item.lower()[:40] and item.lower()[:40] in article_lower]
        unsupported_claims = []
        if not matched:
            unsupported_claims.append("The draft does not appear to reuse grounded evidence directly enough.")
        approved = bool(article.strip()) and len(unsupported_claims) == 0
        return {
            "approved": approved,
            "factual_accuracy_score": 100 if approved else 55,
            "completeness_score": 85 if approved else 60,
            "unsupported_claims": unsupported_claims,
            "verified_claims": matched[:10],
            "revision_instructions": ["Rewrite unsupported claims so each one maps back to grounded context."] if unsupported_claims else [],
            "reasoning": "Fallback audit based on overlap between grounded evidence and final draft.",
        }

    @traceable(run_type="chain", name="Draft Auditor")
    async def audit_article(
        self,
        game_title: str,
        article: str,
        grounded_context: Dict[str, Any],
        investigation: Dict[str, Any],
        outline: Dict[str, Any],
    ) -> Dict[str, Any]:
        fallback = self._fallback_audit(article, grounded_context, investigation)
        compact_grounded_context = compact_for_llm(grounded_context, max_depth=5, max_list_items=6, max_dict_items=16, max_string_length=240)
        compact_investigation = compact_for_llm(investigation, max_depth=5, max_list_items=6, max_dict_items=16, max_string_length=240)
        compact_outline = compact_for_llm(outline, max_depth=4, max_list_items=10, max_dict_items=16, max_string_length=220)
        result = await self.ai.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the Stage 6 Auditor for ArcadeBox. Reject unsupported claims. Respond only with JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Task: Audit this draft for '{game_title}'.\n"
                        f"Grounded context:\n{json_dumps_safe(compact_grounded_context, indent=2)}\n"
                        f"Investigation:\n{json_dumps_safe(compact_investigation, indent=2)}\n"
                        f"Outline:\n{json_dumps_safe(compact_outline, indent=2)}\n"
                        f"Article:\n{article}\n\n"
                        "Return ONLY valid JSON with keys: approved, factual_accuracy_score, completeness_score, "
                        "unsupported_claims, verified_claims, revision_instructions, reasoning."
                    ),
                },
            ],
            response_format={"type": "json_object"},
            pydantic_schema=AuditReportOutput,
            fallback_data=fallback,
            metadata={"stage": "auditor"},
        )
        self.last_cost = self.ai.last_cost
        return result
