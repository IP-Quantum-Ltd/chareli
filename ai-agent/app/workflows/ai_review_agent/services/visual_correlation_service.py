from typing import Any, Dict


class VisualCorrelationService:
    def score_candidate(self, correlation: Dict[str, Any], seo_intelligence: Dict[str, Any]) -> Dict[str, Any]:
        visual_score = int(correlation.get("visual_match_score") or correlation.get("confidence_score") or 0)
        text_score = int(seo_intelligence.get("relevance_score") or 0)
        exact_match_bonus = 10 if seo_intelligence.get("exact_title_match") else 0
        source_quality_bonus = 5 if seo_intelligence.get("source_quality") == "high" else 0
        confidence_score = max(0, min(100, int((visual_score * 0.7) + (text_score * 0.3) + exact_match_bonus + source_quality_bonus)))
        return {"visual_score": visual_score, "text_score": text_score, "exact_match_bonus": exact_match_bonus, "source_quality_bonus": source_quality_bonus, "confidence_score": confidence_score}

    def build_candidate_seo_intelligence(self, game_title: str, search_query: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        title = str(metadata.get("title") or "")
        description = str(metadata.get("meta_description") or "")
        headings = metadata.get("headings") or []
        body = " ".join([title, description, " ".join(headings[:10])]).lower()
        exact_title_match = game_title.lower() in body
        query_terms = [term.lower() for term in search_query.split() if term.strip()]
        query_hits = sum(1 for term in query_terms if term in body)
        relevance_score = min(100, (20 if exact_title_match else 0) + (query_hits * 8))
        source_quality = "high" if metadata.get("canonical_url") else "medium"
        return {"exact_title_match": exact_title_match, "query_hits": query_hits, "relevance_score": relevance_score, "source_quality": source_quality}
