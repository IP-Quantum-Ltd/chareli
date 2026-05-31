import logging
from typing import Any, Dict, List

from langsmith import traceable

from app.domain.schemas.llm_outputs import AuditReportOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm
from app.workflows.ai_review_agent.services.proposal_structure import (
    CANONICAL_SECTIONS,
    ArticleSectionExtractor,
)
from app.workflows.ai_review_agent.services.trademark_guard import scan_for_trademarks

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

    def _structural_checks(self, article: str) -> Dict[str, Any]:
        """
        Deterministic pre-LLM structural checks.
        Returns a dict with: missing_sections, cross_section_duplicates, trademark_violations.
        No LLM cost.
        """
        extractor = ArticleSectionExtractor(article)
        missing = extractor.missing_sections(CANONICAL_SECTIONS)
        duplicates = extractor.detect_cross_section_duplicates()
        trademark_hits = scan_for_trademarks(article)
        return {
            "missing_sections": missing,
            "cross_section_duplicates": duplicates,
            "trademark_violations": trademark_hits,
        }

    def _fallback_audit(self, article: str, grounded_context: Dict[str, Any], investigation: Dict[str, Any]) -> Dict[str, Any]:
        evidence = self._flatten_evidence(grounded_context, investigation)
        article_lower = (article or "").lower()
        matched = [item for item in evidence[:20] if item.lower()[:40] and item.lower()[:40] in article_lower]
        checks = self._structural_checks(article)

        unsupported_claims: List[str] = []
        revision_instructions: List[str] = []

        # Structural violations
        if checks["missing_sections"]:
            for s in checks["missing_sections"]:
                unsupported_claims.append(f"Section '{s}' is missing from the article.")
            revision_instructions.append(
                f"Add the following missing sections (in order): {', '.join(checks['missing_sections'])}."
            )

        # Cross-section duplicates
        if checks["cross_section_duplicates"]:
            for dup in checks["cross_section_duplicates"][:5]:
                unsupported_claims.append(f"Duplicate content found: {dup}")
            revision_instructions.append(
                "Remove content that appears in more than one section. Each section must be unique."
            )

        # Trademark violations
        if checks["trademark_violations"]:
            revision_instructions.append(
                f"Remove all trademark/brand name mentions: {', '.join(checks['trademark_violations'])}. "
                "Replace with generic descriptors."
            )

        if not matched:
            unsupported_claims.append("The draft does not appear to reuse grounded evidence directly enough.")
            revision_instructions.append("Rewrite unsupported claims so each one maps back to grounded context.")

        section_structure_ok = not checks["missing_sections"]
        approved = (
            bool(article.strip())
            and section_structure_ok
            and not checks["trademark_violations"]
            and len(unsupported_claims) == 0
        )

        return {
            "approved": approved,
            "factual_accuracy_score": 100 if approved else 55,
            "completeness_score": 85 if (section_structure_ok and matched) else 60,
            "unsupported_claims": unsupported_claims,
            "verified_claims": matched[:10],
            "revision_instructions": revision_instructions,
            "reasoning": (
                "Fallback audit: checked 5-section structure, cross-section de-duplication, "
                "trademark scan, and grounded evidence overlap."
            ),
            "section_structure_ok": section_structure_ok,
            "cross_section_duplicates": checks["cross_section_duplicates"][:10],
            "trademark_violations": checks["trademark_violations"],
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
        # Run deterministic checks first (no LLM cost)
        checks = self._structural_checks(article)
        fallback = self._fallback_audit(article, grounded_context, investigation)

        compact_grounded_context = compact_for_llm(grounded_context, max_depth=5, max_list_items=6, max_dict_items=16, max_string_length=240)
        compact_investigation = compact_for_llm(investigation, max_depth=5, max_list_items=6, max_dict_items=16, max_string_length=240)
        compact_outline = compact_for_llm(outline, max_depth=4, max_list_items=10, max_dict_items=16, max_string_length=220)

        structural_notes = ""
        if checks["missing_sections"]:
            structural_notes += f"\nMISSING SECTIONS (auto-detected): {', '.join(checks['missing_sections'])}."
        if checks["trademark_violations"]:
            structural_notes += f"\nTRADEMARK VIOLATIONS (auto-detected): {', '.join(checks['trademark_violations'])}."
        if checks["cross_section_duplicates"]:
            structural_notes += f"\nCROSS-SECTION DUPLICATES (auto-detected): {len(checks['cross_section_duplicates'])} found."

        result = await self.ai.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the Stage 6 Auditor for ArcadeBox. "
                        f"The article MUST contain exactly these 5 sections in order: {', '.join(CANONICAL_SECTIONS)}. "
                        "Reject articles that: (1) omit or merge sections, (2) repeat content across sections, "
                        "(3) mention competitor game brand names or trademarks, (4) contain hallucinated facts "
                        "not present in the grounded context. "
                        "Respond only with JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Task: Audit this draft for '{game_title}'.{structural_notes}\n"
                        f"Grounded context:\n{json_dumps_safe(compact_grounded_context, indent=2)}\n"
                        f"Investigation:\n{json_dumps_safe(compact_investigation, indent=2)}\n"
                        f"Outline:\n{json_dumps_safe(compact_outline, indent=2)}\n"
                        f"Article:\n{article}\n\n"
                        "Return ONLY valid JSON with keys: approved, factual_accuracy_score, completeness_score, "
                        "unsupported_claims, verified_claims, revision_instructions, reasoning, "
                        "section_structure_ok, cross_section_duplicates, trademark_violations."
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
