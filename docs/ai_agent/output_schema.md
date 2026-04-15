# AI Review Agent — Output Schema
**Project:** ArcadeBox AI Game Review Agent | **Version:** 1.3

## JSON Schema

```json
{
  "recommendation": "approved | manual_review | declined",
  "reasoning": "string — evidence-based explanation citing web findings",
  "metrics_scores": {
    "title_authenticity": 0.0,
    "developer_credibility": 0.0,
    "description_quality": 0.0,
    "category_accuracy": 0.0,
    "data_consistency": 0.0,
    "visual_metadata_alignment": 0.0
  },
  "enriched_data": {
    "discovered_title": "string | null",
    "discovered_developer": "string | null",
    "discovered_description": "string | null",
    "discovered_category": "string | null",
    "discovered_faq": [
      { "question": "string", "answer": "string" }
    ]
  },
  "flags": ["string — e.g. 'Developer Unverified', 'Category Mismatch'"],
  "confidence_score": 0.0
}
```

> [!NOTE]
> All `metrics_scores` values are between **0.0 and 1.0**.
> `enriched_data` fields are only populated when the submitted data was missing and the agent discovered it via web search.

## Example — Enrichment Case (Missing Description & Developer)

```json
{
  "recommendation": "approved",
  "reasoning": "Game identified via screenshot as 'Shadow Runner'. No developer was submitted; discovered 'Void Games' on itch.io. Description and FAQ populated from official page. Visuals consistent.",
  "metrics_scores": {
    "title_authenticity": 0.95,
    "developer_credibility": 0.85,
    "description_quality": 0.9,
    "category_accuracy": 1.0,
    "data_consistency": 0.9,
    "visual_metadata_alignment": 1.0
  },
  "enriched_data": {
    "discovered_title": "Shadow Runner",
    "discovered_developer": "Void Games",
    "discovered_description": "A high-octane 2D platformer set in a neon-dystopian city.",
    "discovered_category": "Action / Platformer",
    "discovered_faq": [
      { "question": "Is there a level editor?", "answer": "Yes, in the premium version." }
    ]
  },
  "flags": ["Missing Original Description", "Developer Enriched from Web"],
  "confidence_score": 0.95
}
```
