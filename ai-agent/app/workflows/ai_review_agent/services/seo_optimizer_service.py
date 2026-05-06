import logging
from datetime import datetime, timezone
from typing import Any, Dict

from langsmith import traceable

from app.config import MongoConfig
from app.domain.schemas.llm_outputs import SeoOptimizerOutput
from app.infrastructure.db.mongo_provider import MongoProvider
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm

logger = logging.getLogger(__name__)


class SeoOptimizerService:
    def __init__(self, ai: AIExecutor, mongo_provider: MongoProvider, mongo_config: MongoConfig):
        self.ai = ai
        self.mongo_provider = mongo_provider
        self.mongo_config = mongo_config
        self.last_cost = 0.0

    def _fallback_output(self, game_title: str, seo_blueprint: Dict[str, Any], audit_report: Dict[str, Any]) -> Dict[str, Any]:
        primary_keyword = ((seo_blueprint.get("primary_keywords") or [game_title])[0]) if seo_blueprint else game_title
        faq_items = seo_blueprint.get("faq_opportunities") or []
        return {
            "meta_title": f"{game_title} Guide: How to Play, Tips, and Strategy",
            "meta_description": f"Play {game_title} with verified gameplay guidance, controls, and strategy tips.",
            "primary_h1": seo_blueprint.get("metadata_recommendations", {}).get("primary_h1", f"{game_title} Guide"),
            "faq_schema": [
                {"question": item.get("question", ""), "answer": item.get("answer_angle", "")}
                for item in faq_items[:5]
                if isinstance(item, dict)
            ],
            "heading_audit": {"primary_keyword": primary_keyword, "h2_count": len((seo_blueprint.get("keyword_clusters") or []))},
            "evaluation": {
                "factual_accuracy_score": int(audit_report.get("factual_accuracy_score", 0) or 0),
                "completeness_score": int(audit_report.get("completeness_score", 0) or 0),
                "overall_ready": bool(audit_report.get("approved", False)),
            },
        }

    async def _persist_evaluation(self, game_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        db = await self.mongo_provider.get_database()
        if db is None:
            return {"status": "disabled", "reason": "MongoDB is not configured."}
        document = dict(payload)
        document["game_id"] = game_id
        document["updated_at"] = datetime.now(timezone.utc)
        try:
            await db[self.mongo_config.evaluation_collection].update_one(
                {"game_id": game_id},
                {"$set": document},
                upsert=True,
            )
        except Exception as exc:
            logger.warning("Failed to persist optimizer evaluation: %s", exc)
            return {"status": "error", "reason": str(exc)}
        return {"status": "success", "collection": self.mongo_config.evaluation_collection}

    @traceable(run_type="chain", name="SEO Optimizer")
    async def optimize(
        self,
        game_id: str,
        game_title: str,
        article: str,
        seo_blueprint: Dict[str, Any],
        outline: Dict[str, Any],
        audit_report: Dict[str, Any],
    ) -> Dict[str, Any]:
        fallback = self._fallback_output(game_title, seo_blueprint, audit_report)
        compact_seo_blueprint = compact_for_llm(seo_blueprint, max_depth=4, max_list_items=6, max_dict_items=14, max_string_length=220)
        compact_outline = compact_for_llm(outline, max_depth=4, max_list_items=10, max_dict_items=16, max_string_length=220)
        compact_audit_report = compact_for_llm(audit_report, max_depth=4, max_list_items=10, max_dict_items=16, max_string_length=220)
        result = await self.ai.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "You are the Stage 7 SEO Optimizer for ArcadeBox. Respond only with JSON.",
                },
                {
                    "role": "user",
                        "content": (
                            f"Task: Optimize the verified article for '{game_title}'.\n"
                        f"SEO blueprint:\n{json_dumps_safe(compact_seo_blueprint, indent=2)}\n"
                        f"Outline:\n{json_dumps_safe(compact_outline, indent=2)}\n"
                        f"Audit report:\n{json_dumps_safe(compact_audit_report, indent=2)}\n"
                        f"Article:\n{article}\n\n"
                        "Return ONLY valid JSON with keys: meta_title, meta_description, primary_h1, faq_schema, "
                        "heading_audit, evaluation."
                    ),
                },
            ],
            response_format={"type": "json_object"},
            pydantic_schema=SeoOptimizerOutput,
            fallback_data=fallback,
            metadata={"stage": "optimizer"},
        )
        self.last_cost = self.ai.last_cost
        persistence = await self._persist_evaluation(game_id, result)
        result["persistence"] = persistence
        return result
