"""
faq_generation_service.py
=========================
Dedicated FAQ post-processing engine.

Collects FAQ candidates from all evidence sources produced by the pipeline,
scores them for uniqueness, grounding, and creativity, de-duplicates, and
returns a ranked list ready for HTML/schema formatting.

Zero LLM calls — all logic is deterministic.

Evidence priority (highest → lowest):
  1. Structured FAQ items from the drafted article's FAQ section
  2. Optimizer faq_schema (Stage 7 — full Q&A pairs)
  3. Grounded context faq_evidence (verified Q&A from crawled pages)
  4. SEO blueprint faq_opportunities (question + answer_angle hints)
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalise_question(question: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — for dedup keys."""
    q = question.lower().strip()
    q = re.sub(r"[^\w\s]", "", q)
    q = re.sub(r"\s+", " ", q)
    return q


def _token_overlap(a: str, b: str) -> float:
    """
    Jaccard token-overlap between two strings.
    Returns 0.0–1.0.  Used for near-duplicate detection.
    """
    tokens_a = set(re.findall(r"\w+", a.lower()))
    tokens_b = set(re.findall(r"\w+", b.lower()))
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def _is_instructional(text: str) -> bool:
    """True if text reads like a writer instruction rather than real content."""
    _INSTRUCTION_RE = re.compile(
        r"^(?:provide|explain|describe|write|add|include|summarize|list|"
        r"insert|fill in|mention|note that|replace this|update|todo)\b",
        re.IGNORECASE,
    )
    return bool(_INSTRUCTION_RE.match(text.strip()))


def _is_meaningful(text: str) -> bool:
    """True if text is non-empty and not a placeholder."""
    if not isinstance(text, str) or not text.strip():
        return False
    _PLACEHOLDER_RE = re.compile(
        r"^(?:unknown|n/?a|none|null|nil|tbd|coming soon|not available|"
        r"not provided|unspecified|placeholder|todo|lorem ipsum)$",
        re.IGNORECASE,
    )
    return not _PLACEHOLDER_RE.match(text.strip())


def _is_unconfirmed_answer(text: str) -> bool:
    """True if the answer indicates a lack of confirmed knowledge (e.g. 'not specified')."""
    _UNCONFIRMED_RE = re.compile(
        r"(?i)\b(?:not\s+(?:publicly\s+)?specified|not\s+(?:publicly\s+)?confirmed|"
        r"unknown|no\s+public\s+information|tbd|to\s+be\s+determined|"
        r"not\s+available|not\s+disclosed|not\s+provided)\b"
    )
    return bool(_UNCONFIRMED_RE.search(text))


def _has_bad_placeholder(text: str) -> bool:
    """True if the text contains a square-bracketed writer placeholder (e.g. '[Insert Strategy]')."""
    _BAD_PLACEHOLDER_RE = re.compile(
        r"\[\s*(?:insert|write|todo|replace|add|strategy|enter|type|your|my|instructions)\b",
        re.IGNORECASE,
    )
    return bool(_BAD_PLACEHOLDER_RE.search(text))


def _clean(text: Any) -> str:
    """Strip HTML tags and collapse whitespace."""
    if not isinstance(text, str):
        return ""
    plain = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", plain).strip()


def _has_nested_faqs(text: str) -> bool:
    """True if the text contains a nested FAQ block or looks like a dumped FAQ section."""
    clean_text = text.lower()
    
    # 1. Reject if it contains headings or titles characteristic of an FAQ section
    if "frequently asked questions" in clean_text or "getting started" in clean_text:
        if len(clean_text) > 100:
            return True
        
    # 2. Check for multiple question marks "?" inside the answer body
    # (indicating multiple questions are embedded in a single answer)
    q_mark_count = clean_text.count("?")
    if q_mark_count >= 2:
        return True
        
    # 3. Check for embedded "Q:" and "A:" patterns or "question" / "answer" labels
    if "q:" in clean_text and "a:" in clean_text:
        return True
        
    return False


def _has_free_play_hallucination(text: str) -> bool:
    """True if the text claims the game is completely free, 100% free, or has no cost/barriers."""
    clean_text = text.lower()
    
    # Reject common unlimited free play / no barriers / no cost phrases
    _FREE_RE = re.compile(
        r"\b(?:completely\s+free|100%\s+free|without\s+(?:any\s+)?cost|no\s+cost|"
        r"free\s+of\s+charge|without\s+(?:any\s+)?barriers|without\s+barriers|"
        r"no\s+barriers|enjoy\s+without\s+barriers|without\s+any\s+cost\s+barriers)\b",
        re.IGNORECASE
    )
    return bool(_FREE_RE.search(clean_text))


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_faq_item(
    question: str,
    answer: str,
    non_faq_content: str,
    existing_normalised: List[str],
    source_priority: int,
) -> float:
    """
    Score a FAQ candidate on 0–100 scale.

    Factors
    -------
    - source_priority  : 0 (article draft) → 30pts, 1 (optimizer) → 25pts,
                         2 (grounded) → 20pts, 3 (seo blueprint) → 15pts
    - answer quality   : length bonus up to 20pts, penalise placeholders
    - uniqueness vs non-FAQ sections: penalty if token_overlap > 0.5
    - de-dup vs existing accepted items: hard reject if overlap > 0.7
    """
    if not _is_meaningful(question) or not _is_meaningful(answer):
        return 0.0
    if _is_instructional(answer):
        return 0.0
    if _is_unconfirmed_answer(answer):
        return 0.0
    if _has_bad_placeholder(question) or _has_bad_placeholder(answer):
        return 0.0
    if _has_nested_faqs(question) or _has_nested_faqs(answer):
        return 0.0
    if _has_free_play_hallucination(question) or _has_free_play_hallucination(answer):
        return 0.0

    source_scores = {0: 30, 1: 25, 2: 20, 3: 15}
    score = float(source_scores.get(source_priority, 10))

    # Answer quality bonus (up to 20 pts)
    answer_len = len(_clean(answer).split())
    score += min(20.0, answer_len * 1.5)

    # Penalise answers that heavily overlap with the non-FAQ section content
    q_clean = _clean(question)
    a_clean = _clean(answer)
    combined = (q_clean + " " + a_clean).lower()
    overlap = _token_overlap(combined, non_faq_content)
    if overlap > 0.6:
        score -= 30.0
    elif overlap > 0.4:
        score -= 15.0

    # Penalise near-duplicates of already accepted items
    norm_q = _normalise_question(question)
    for existing_norm in existing_normalised:
        if _token_overlap(norm_q, existing_norm) > 0.7:
            return 0.0  # Hard reject

    return max(0.0, score)


# ---------------------------------------------------------------------------
# Public service class
# ---------------------------------------------------------------------------

class FaqGenerationService:
    """
    Collects, scores, de-duplicates, and ranks FAQ candidates from all
    pipeline evidence sources.

    Parameters
    ----------
    min_items : int
        Minimum number of FAQ items to return.  If the scored pool cannot
        satisfy this, the best available items are used with a warning.
    max_items : int
        Maximum number of FAQ items to return.
    similarity_threshold : float
        Jaccard token-overlap threshold (0–1) above which two questions
        are considered duplicates.  Default 0.70.
    """

    def __init__(
        self,
        min_items: int = 3,
        max_items: int = 8,
        similarity_threshold: float = 0.70,
    ) -> None:
        self.min_items = min_items
        self.max_items = max_items
        self.similarity_threshold = similarity_threshold

    def generate(
        self,
        *,
        # The 4 non-FAQ sections' combined plain text (for overlap scoring)
        non_faq_content: str = "",
        # Source 0: FAQ items parsed directly from the drafted article
        article_faq_items: Optional[List[Dict[str, str]]] = None,
        # Source 1: Optimizer faq_schema [{question, answer}]
        optimizer_faq_schema: Optional[List[Dict[str, Any]]] = None,
        # Source 2: Grounded context faq_evidence [{question, answer}]
        grounded_faq_evidence: Optional[List[Dict[str, str]]] = None,
        # Source 3: SEO blueprint faq_opportunities [{question, answer_angle, ...}]
        seo_faq_opportunities: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, str]]:
        """
        Return a ranked, de-duplicated list of FAQ items.

        Each item: {"question": str, "answer": str}
        """
        candidates: List[Dict[str, Any]] = []  # {question, answer, priority, score}

        def _add(items: List[Dict[str, Any]], priority: int, q_key: str, a_key: str) -> None:
            for item in items or []:
                q = _clean(item.get(q_key) or "")
                a = _clean(item.get(a_key) or "")
                if q and a:
                    candidates.append({"question": q, "answer": a, "priority": priority})

        _add(article_faq_items or [], 0, "question", "answer")
        _add(optimizer_faq_schema or [], 1, "question", "answer")
        _add(grounded_faq_evidence or [], 2, "question", "answer")

        # SEO blueprint uses answer_angle instead of answer
        for opp in (seo_faq_opportunities or []):
            q = _clean(opp.get("question") or "")
            a = _clean(opp.get("answer_angle") or opp.get("answer") or "")
            if q and a:
                candidates.append({"question": q, "answer": a, "priority": 3})

        if not candidates:
            logger.warning("[FaqGenerationService] No FAQ candidates found from any source.")
            return []

        # Score all candidates
        non_faq_plain = _clean(non_faq_content).lower()
        accepted_normalised: List[str] = []
        scored: List[Dict[str, Any]] = []

        for cand in candidates:
            s = _score_faq_item(
                question=cand["question"],
                answer=cand["answer"],
                non_faq_content=non_faq_plain,
                existing_normalised=accepted_normalised,
                source_priority=cand["priority"],
            )
            if s > 0:
                scored.append({**cand, "score": s})
                accepted_normalised.append(_normalise_question(cand["question"]))

        # Sort by score descending
        scored.sort(key=lambda x: x["score"], reverse=True)

        # De-duplicate: keep highest-scored, reject near-duplicates
        result: List[Dict[str, str]] = []
        seen_normalised: List[str] = []

        for item in scored:
            norm_q = _normalise_question(item["question"])
            is_dup = any(
                _token_overlap(norm_q, seen) >= self.similarity_threshold
                for seen in seen_normalised
            )
            if is_dup:
                continue
            result.append({"question": item["question"], "answer": item["answer"]})
            seen_normalised.append(norm_q)
            if len(result) >= self.max_items:
                break

        if len(result) < self.min_items:
            logger.warning(
                "[FaqGenerationService] Only %d FAQ items passed quality checks "
                "(minimum is %d). Using best available.",
                len(result),
                self.min_items,
            )
            # If we have fewer than min, pad with any remaining scored items
            for item in scored:
                if len(result) >= self.min_items:
                    break
                norm_q = _normalise_question(item["question"])
                already = any(
                    _token_overlap(norm_q, seen) >= self.similarity_threshold
                    for seen in seen_normalised
                )
                if already:
                    continue
                entry = {"question": item["question"], "answer": item["answer"]}
                if entry not in result:
                    result.append(entry)
                    seen_normalised.append(norm_q)

        logger.info(
            "[FaqGenerationService] Produced %d FAQ items from %d candidates.",
            len(result),
            len(candidates),
        )
        return result
