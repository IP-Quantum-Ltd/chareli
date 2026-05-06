from __future__ import annotations

from typing import Any

from app.services.json_utils import sanitize_for_json


_OMIT_KEYS = {
    "embedding",
    "screenshot_base64",
}

_TRUNCATE_STRING_KEYS = {
    "content",
    "main_text_excerpt",
    "reasoning",
    "meta_description",
    "og_description",
    "text",
    "snippet",
}


def _trim_text(value: str, limit: int) -> str:
    compact = " ".join(value.split())
    return compact if len(compact) <= limit else compact[:limit].rstrip() + "..."


def compact_for_llm(
    value: Any,
    *,
    max_depth: int = 6,
    max_list_items: int = 8,
    max_dict_items: int = 24,
    max_string_length: int = 400,
    key: str = "",
    depth: int = 0,
) -> Any:
    value = sanitize_for_json(value)

    if depth >= max_depth:
        if isinstance(value, dict):
            return f"<omitted {len(value)} fields at depth limit>"
        if isinstance(value, list):
            return f"<omitted {len(value)} items at depth limit>"
        if isinstance(value, str):
            return _trim_text(value, max_string_length)
        return value

    if key in _OMIT_KEYS:
        if isinstance(value, list):
            return f"<omitted {key} with {len(value)} items>"
        return f"<omitted {key}>"

    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        items = list(value.items())
        for item_key, item_value in items[:max_dict_items]:
            compacted[str(item_key)] = compact_for_llm(
                item_value,
                max_depth=max_depth,
                max_list_items=max_list_items,
                max_dict_items=max_dict_items,
                max_string_length=max_string_length,
                key=str(item_key),
                depth=depth + 1,
            )
        if len(items) > max_dict_items:
            compacted["_truncated_fields"] = len(items) - max_dict_items
        return compacted

    if isinstance(value, list):
        compacted_list = [
            compact_for_llm(
                item,
                max_depth=max_depth,
                max_list_items=max_list_items,
                max_dict_items=max_dict_items,
                max_string_length=max_string_length,
                key=key,
                depth=depth + 1,
            )
            for item in value[:max_list_items]
        ]
        if len(value) > max_list_items:
            compacted_list.append(f"<truncated {len(value) - max_list_items} more items>")
        return compacted_list

    if isinstance(value, str):
        limit = max_string_length * 2 if key not in _TRUNCATE_STRING_KEYS else max_string_length
        return _trim_text(value, limit)

    return value
