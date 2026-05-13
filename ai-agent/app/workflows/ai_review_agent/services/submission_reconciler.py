import html
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional


_URL_RE = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>'\"]+")
_DOMAIN_RE = re.compile(r"(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b")
_WHITESPACE_RE = re.compile(r"\s+")
_PLACEHOLDER_RE = re.compile(
    r"(?i)^(?:unknown|n/?a|none|null|nil|tbd|coming soon|not available|not provided|unspecified)$"
)
_INSTRUCTIONAL_RE = re.compile(
    r"(?i)^(?:provide|explain|describe|write|add|include|summarize|list)\b"
)
_LOW_SIGNAL_DEVELOPER_RE = re.compile(
    r"(?i)^(?:plays|gamepix|silvergames|primarygames|game-game|y8|yad|crazygames|poki|miniplay)$"
)


def _collapse_whitespace(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value).strip()


def _domain_to_label(token: str) -> str:
    cleaned = token.strip().strip(".,;:!?()[]{}<>\"'")
    cleaned = re.sub(r"(?i)^https?://", "", cleaned)
    cleaned = re.sub(r"(?i)^www\.", "", cleaned)
    cleaned = cleaned.split("/", 1)[0]
    cleaned = cleaned.split("?", 1)[0]
    cleaned = cleaned.split("#", 1)[0]
    parts = [part for part in cleaned.split(".") if part]
    if not parts:
        return ""
    return parts[0].lower()


def sanitize_user_facing_text(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""

    def replace_url(match: re.Match[str]) -> str:
        return _domain_to_label(match.group(0))

    def replace_domain(match: re.Match[str]) -> str:
        return _domain_to_label(match.group(0))

    sanitized = _URL_RE.sub(replace_url, value)
    sanitized = _DOMAIN_RE.sub(replace_domain, sanitized)
    sanitized = re.sub(r"\s+([,.;:!?])", r"\1", sanitized)
    return _collapse_whitespace(sanitized)


def is_placeholder_text(value: str) -> bool:
    return bool(_PLACEHOLDER_RE.match(_collapse_whitespace(value)))


def is_meaningful_string(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    collapsed = _collapse_whitespace(value)
    if not collapsed:
        return False
    return not is_placeholder_text(collapsed)


def is_instructional_text(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_INSTRUCTIONAL_RE.match(_collapse_whitespace(value)))


def is_valid_developer_value(value: Any) -> bool:
    if not is_meaningful_string(value):
        return False
    collapsed = _collapse_whitespace(str(value))
    return not _LOW_SIGNAL_DEVELOPER_RE.match(collapsed)


def sanitize_recursive(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_user_facing_text(value)
    if isinstance(value, list):
        return [sanitize_recursive(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_recursive(item) for key, item in value.items()}
    return value


def _prefer_string(candidate: Any, current: Any) -> str:
    sanitized_candidate = sanitize_user_facing_text(candidate or "")
    if is_meaningful_string(sanitized_candidate):
        return sanitized_candidate
    sanitized_current = sanitize_user_facing_text(current or "")
    if is_meaningful_string(sanitized_current):
        return sanitized_current
    return sanitized_candidate or sanitized_current


def _prefer_developer(candidate: Any, current: Any) -> str:
    sanitized_candidate = sanitize_user_facing_text(candidate or "")
    if is_valid_developer_value(sanitized_candidate):
        return sanitized_candidate
    sanitized_current = sanitize_user_facing_text(current or "")
    if is_valid_developer_value(sanitized_current):
        return sanitized_current
    return ""


def _prefer_string_list(candidate: Any, current: Any) -> List[str]:
    candidate_items = [
        sanitize_user_facing_text(item)
        for item in (candidate or [])
        if isinstance(item, str)
    ]
    candidate_items = [item for item in candidate_items if is_meaningful_string(item)]
    if candidate_items:
        return candidate_items
    current_items = [
        sanitize_user_facing_text(item)
        for item in (current or [])
        if isinstance(item, str)
    ]
    return [item for item in current_items if is_meaningful_string(item)]


def _prefer_json(candidate: Any, current: Any) -> Any:
    sanitized_candidate = sanitize_recursive(candidate)
    if isinstance(sanitized_candidate, dict) and sanitized_candidate:
        return sanitized_candidate
    if isinstance(sanitized_candidate, str) and is_meaningful_string(sanitized_candidate):
        return sanitized_candidate
    if isinstance(sanitized_candidate, list) and sanitized_candidate:
        return sanitized_candidate
    return sanitize_recursive(current)


def _normalize_question(question: str) -> str:
    normalized = sanitize_user_facing_text(question).lower()
    normalized = normalized.rstrip("?.!:;")
    return _collapse_whitespace(normalized)


def _choose_answer(current_answer: str, new_answer: str) -> str:
    current_clean = sanitize_user_facing_text(current_answer)
    new_clean = sanitize_user_facing_text(new_answer)
    current_ok = is_meaningful_string(current_clean)
    new_ok = is_meaningful_string(new_clean)
    if new_ok and not current_ok:
        return new_clean
    if current_ok and not new_ok:
        return current_clean
    if new_ok and current_ok and len(new_clean) > int(len(current_clean) * 1.1):
        return new_clean
    return current_clean or new_clean


class _FaqHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._current_tag = ""
        self._buffer: List[str] = []
        self._pending_question = ""
        self.items: List[Dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        self._current_tag = tag.lower()
        self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._current_tag in {"h3", "h4", "p"}:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        current_text = _collapse_whitespace(html.unescape("".join(self._buffer)))
        tag = tag.lower()
        if tag in {"h3", "h4"}:
            question = re.sub(r"(?i)^q:\s*", "", current_text).strip()
            if question and question.lower() != "faq":
                self._pending_question = question
        elif tag == "p" and self._pending_question and current_text:
            self.items.append({"question": self._pending_question, "answer": current_text})
            self._pending_question = ""
        self._current_tag = ""
        self._buffer = []


def _faq_from_html(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, str) or not value.strip():
        return []
    parser = _FaqHtmlParser()
    parser.feed(value)
    return parser.items


def _faq_from_schema(items: Any) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        question = item.get("question") or item.get("name") or ""
        answer = item.get("answer") or ((item.get("acceptedAnswer") or {}).get("text")) or ""
        question = sanitize_user_facing_text(question)
        answer = sanitize_user_facing_text(answer)
        if (
            is_meaningful_string(question)
            and is_meaningful_string(answer)
            and not is_instructional_text(answer)
        ):
            results.append({"question": question, "answer": answer})
    return results


def merge_faq_content(current_html: Any, new_html: Any, new_schema: Any) -> List[Dict[str, str]]:
    merged: List[Dict[str, str]] = []
    index: Dict[str, int] = {}

    def add_item(question: str, answer: str) -> None:
        normalized = _normalize_question(question)
        if not normalized:
            return
        question_clean = sanitize_user_facing_text(question)
        answer_clean = sanitize_user_facing_text(answer)
        if not (
            is_meaningful_string(question_clean)
            and is_meaningful_string(answer_clean)
            and not is_instructional_text(answer_clean)
        ):
            return
        if normalized in index:
            slot = index[normalized]
            merged[slot]["answer"] = _choose_answer(merged[slot]["answer"], answer_clean)
            return
        index[normalized] = len(merged)
        merged.append({"question": question_clean, "answer": answer_clean})

    for item in _faq_from_html(current_html):
        add_item(item["question"], item["answer"])
    for item in _faq_from_html(new_html):
        add_item(item["question"], item["answer"])
    for item in _faq_from_schema(new_schema):
        add_item(item["question"], item["answer"])
    return merged


def faq_items_to_html(items: List[Dict[str, str]]) -> str:
    if not items:
        return ""
    chunks = ["<h3>FAQ</h3>"]
    for item in items:
        question = html.escape(item["question"], quote=False)
        answer = html.escape(item["answer"], quote=False)
        chunks.append(f"<h4>Q: {question}</h4><p>{answer}</p>")
    return "".join(chunks)


def faq_items_to_schema(items: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    return [
        {
            "@type": "Question",
            "name": item["question"],
            "acceptedAnswer": {
                "@type": "Answer",
                "text": item["answer"],
            },
        }
        for item in items
        if is_meaningful_string(item.get("question")) and is_meaningful_string(item.get("answer"))
    ]


class SubmissionReconciler:
    def reconcile(
        self,
        proposed_game_data: Dict[str, Any],
        seo_meta: Dict[str, Any],
        current_game: Dict[str, Any],
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        _raw_cur_meta = (current_game.get("metadata") or {}) if isinstance(current_game, dict) else {}
        current_metadata = _raw_cur_meta if isinstance(_raw_cur_meta, dict) else {}
        _raw_cur_seo = (current_game.get("seoMeta") or {}) if isinstance(current_game, dict) else {}
        current_seo = _raw_cur_seo if isinstance(_raw_cur_seo, dict) else {}
        _raw_cand_meta = (proposed_game_data or {}).get("metadata") or {}
        candidate_metadata = _raw_cand_meta if isinstance(_raw_cand_meta, dict) else {}
        _raw_cand_seo = seo_meta or {}
        candidate_seo = _raw_cand_seo if isinstance(_raw_cand_seo, dict) else {}

        merged_faq = merge_faq_content(
            current_metadata.get("faqOverride"),
            candidate_metadata.get("faqOverride"),
            candidate_seo.get("faq_schema"),
        )

        reconciled_metadata = {
            "howToPlay": _prefer_string(candidate_metadata.get("howToPlay"), current_metadata.get("howToPlay")),
            "features": _prefer_string_list(candidate_metadata.get("features"), current_metadata.get("features")),
            "tags": _prefer_string_list(candidate_metadata.get("tags"), current_metadata.get("tags")),
            "seoKeywords": _prefer_string(candidate_metadata.get("seoKeywords"), current_metadata.get("seoKeywords")),
            "developer": _prefer_developer(candidate_metadata.get("developer"), current_metadata.get("developer")),
            "platform": _prefer_string_list(candidate_metadata.get("platform"), current_metadata.get("platform")),
            "releaseDate": _prefer_string(candidate_metadata.get("releaseDate"), current_metadata.get("releaseDate")),
            "faqOverride": faq_items_to_html(merged_faq) or _prefer_string(
                candidate_metadata.get("faqOverride"),
                current_metadata.get("faqOverride"),
            ),
        }

        reconciled_game_data = {
            **dict(proposed_game_data or {}),
            "title": _prefer_string((proposed_game_data or {}).get("title"), current_game.get("title")),
            "description": _prefer_string((proposed_game_data or {}).get("description"), current_game.get("description")),
            "categoryId": (proposed_game_data or {}).get("categoryId") or current_game.get("categoryId"),
            "metadata": reconciled_metadata,
        }

        reconciled_seo = {
            **candidate_seo,
            "title_tag": _prefer_string(candidate_seo.get("title_tag"), current_seo.get("title_tag")),
            "meta_description": _prefer_string(candidate_seo.get("meta_description"), current_seo.get("meta_description")),
            "primary_h1": _prefer_string(candidate_seo.get("primary_h1"), current_seo.get("primary_h1")),
            "primary_keywords": _prefer_string_list(candidate_seo.get("primary_keywords"), current_seo.get("primary_keywords")),
            "json_ld": _prefer_json(candidate_seo.get("json_ld"), current_seo.get("json_ld")),
            "faq_schema": faq_items_to_schema(merged_faq)
            or faq_items_to_schema(_faq_from_schema(current_seo.get("faq_schema"))),
        }

        json_ld = reconciled_seo.get("json_ld")
        if isinstance(json_ld, dict):
            json_ld["name"] = reconciled_game_data["title"]
            json_ld["description"] = reconciled_seo["meta_description"] or reconciled_game_data["description"]
            author = json_ld.get("author")
            if not isinstance(author, dict):
                author = {"@type": "Organization"}
            author["name"] = reconciled_metadata["developer"] or author.get("name", "")
            json_ld["author"] = author
            json_ld["gamePlatform"] = "Browser"

        return sanitize_recursive(reconciled_game_data), sanitize_recursive(reconciled_seo)
