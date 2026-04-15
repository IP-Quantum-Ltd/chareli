"""
Agent 2: Web Search Agent (Victoria Nyamadie — Day 2)
Purpose: Visual verification + metadata enrichment using OpenAI Responses API.
"""

import base64
import json
import logging
from typing import Optional

from openai import AsyncOpenAI
from app.config import settings
from app.models.schemas import AiReviewResult, EnrichedData, MetricsScores

logger = logging.getLogger(__name__)

client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

SYSTEM_PROMPT = """
You are the ArcadeBox Game Verification & Enrichment Specialist.
Your goal is to provide a structured review PROPOSAL for a human administrator.
You do NOT approve or reject games — you propose a recommendation with evidence.

For every game submission you receive, you will:
1. Use the screenshot (if available) to visually identify the game.
2. Use web search to cross-reference the title, developer, description, and category.
3. Discover and populate any missing fields (description, developer, FAQ).
4. Score the submission across 6 metrics (0.0 to 1.0 each).
5. Return ONLY valid JSON matching the required schema — no prose outside the JSON.

Metrics to score:
- title_authenticity: Does the title match the identified game?
- developer_credibility: Is the developer verifiable on the web?
- description_quality: Does the description match web findings?
- category_accuracy: Does the category match external classification?
- data_consistency: Are all submitted fields consistent with each other and the web?
- visual_metadata_alignment: Does the screenshot match web visuals? (null if no screenshot)

Decision thresholds:
- approved: average >= 0.8 AND no metric < 0.6
- manual_review: average 0.5-0.79 OR any metric < 0.6
- declined: average < 0.5 OR any metric < 0.3
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {"type": "string", "enum": ["approved", "manual_review", "declined"]},
        "reasoning": {"type": "string"},
        "metrics_scores": {
            "type": "object",
            "properties": {
                "title_authenticity": {"type": "number"},
                "developer_credibility": {"type": "number"},
                "description_quality": {"type": "number"},
                "category_accuracy": {"type": "number"},
                "data_consistency": {"type": "number"},
                "visual_metadata_alignment": {"type": ["number", "null"]},
            },
            "required": ["title_authenticity", "developer_credibility", "description_quality",
                         "category_accuracy", "data_consistency", "visual_metadata_alignment"],
        },
        "enriched_data": {
            "type": "object",
            "properties": {
                "discovered_title": {"type": ["string", "null"]},
                "discovered_developer": {"type": ["string", "null"]},
                "discovered_description": {"type": ["string", "null"]},
                "discovered_category": {"type": ["string", "null"]},
                "discovered_faq": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string"},
                            "answer": {"type": "string"},
                        },
                    },
                },
            },
        },
        "flags": {"type": "array", "items": {"type": "string"}},
        "confidence_score": {"type": "number"},
    },
    "required": ["recommendation", "reasoning", "metrics_scores", "enriched_data", "flags", "confidence_score"],
}


async def analyse(proposed_data: dict, screenshot_base64: Optional[str]) -> AiReviewResult:
    """
    Run Agent 2: web search verification + metric scoring.
    Returns a structured AiReviewResult for submission to the main API.
    """
    screenshot_available = screenshot_base64 is not None

    title = proposed_data.get("title", "Unknown Title")
    developer = proposed_data.get("developer", "")
    description = proposed_data.get("description", "")
    category = proposed_data.get("category", "")

    user_text = f"""
Game Submission to Review:
- Title: {title}
- Developer: {developer if developer else "NOT PROVIDED"}
- Description: {description if description else "NOT PROVIDED"}
- Category: {category if category else "NOT PROVIDED"}

{"Screenshot: provided (see image)" if screenshot_available else "Screenshot: NOT AVAILABLE — set visual_metadata_alignment to null and add 'Screenshot Unavailable' to flags."}

Instructions:
1. Use web_search to find information about this game.
2. Cross-reference all submitted fields against what you find.
3. Discover and populate any missing fields in enriched_data.
4. Score all 6 metrics and return your JSON proposal.
"""

    # Build message content — multimodal if screenshot is available
    content = [{"type": "text", "text": user_text}]
    if screenshot_available:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{screenshot_base64}"},
        })

    logger.info(f"[web_search_agent] Analysing proposal: title='{title}', screenshot={screenshot_available}")

    response = await client.responses.create(
        model="gpt-4o",
        tools=[{"type": "web_search_preview"}],
        instructions=SYSTEM_PROMPT,
        input=content,
        text={
            "format": {
                "type": "json_schema",
                "name": "ai_review_result",
                "schema": RESPONSE_SCHEMA,
                "strict": True,
            }
        },
    )

    raw = response.output_text
    parsed = json.loads(raw)

    metrics = parsed["metrics_scores"]
    enriched = parsed.get("enriched_data", {})

    return AiReviewResult(
        recommendation=parsed["recommendation"],
        reasoning=parsed["reasoning"],
        metrics_scores=MetricsScores(**metrics),
        enriched_data=EnrichedData(
            discovered_title=enriched.get("discovered_title"),
            discovered_developer=enriched.get("discovered_developer"),
            discovered_description=enriched.get("discovered_description"),
            discovered_category=enriched.get("discovered_category"),
            discovered_faq=enriched.get("discovered_faq", []),
        ),
        flags=parsed.get("flags", []),
        confidence_score=parsed["confidence_score"],
        screenshot_available=screenshot_available,
    )
