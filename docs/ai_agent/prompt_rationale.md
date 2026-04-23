# Prompt Structure & Rationale
**Project:** ArcadeBox AI Game Review Agent | **Version:** 1.0 | **Author:** Victoria Nyamadie

---

## 1. Overview
This document explains the structure and reasoning behind the Web Search Agent (Agent 2) prompt design. It is intended for team review and to guide future revisions.

The agent is a **Provisional Reviewer** — it never approves or rejects games autonomously. Its sole output is a structured **review proposal** for the human administrator. This is a hard constraint built directly into the persona and must be preserved in all future prompt versions.

---

## 2. Persona Design

**Design Decision:** The agent is given the identity of an **expert reviewer** with a specific mandate rather than a generic AI assistant.

**Why:** A defined persona sets behavioral guardrails. By specifying "you do not approve or reject — you propose," we prevent the model from taking a decisive tone in its reasoning. This is critical because admins see the AI's reasoning verbatim in the dashboard; it must read as advisory, not authoritative.

---

## 3. Conditional Scoring Logic

**Design Decision:** Each of the 6 metrics has two paths — one for when data is present, one for when it is missing.

**Why:** Submissions on the platform will not always be fully populated. A new game may be uploaded with only a title and a screenshot. Treating a missing description as a `0` score would unfairly penalize legitimate submissions. Instead:

- **Data present** → Agent cross-references against the web.
- **Data missing** → Agent uses the screenshot and title to discover the correct information, then scores based on how well it was able to enrich the data.

This ensures the score always reflects **accuracy and effort**, not just data completeness.

---

## 4. Visual-First Search Approach

**Design Decision:** The screenshot from Agent 1 is the primary anchor for web search, not the title.

**Why:** Game titles can vary across platforms (e.g., a game may be called "Super Run" on itch.io but "Super Runner Pro" on the Arcade platform). Hard-matching on title alone would produce false negatives. Using visual cues (art style, characters, UI layout) provides a platform-agnostic way to identify the game and then confirm if the submitted title is an acceptable variant.

---

## 5. Enrichment Mandate

**Design Decision:** The agent is explicitly instructed to populate `enriched_data` with any fields it discovers during web search.

**Why:** The platform's game submission pipeline is designed for continuous enrichment. If a developer submits with no description or FAQ, the AI agent discovering and providing that information saves admin time and reduces back-and-forth with developers. The enriched data is surfaced in the admin's review panel for final approval.

---

## 6. Screenshot Null Handling

**Design Decision:** If Agent 1 fails to capture a screenshot, `visual_metadata_alignment` is set to `null` (not `0`) and a `"Screenshot Unavailable"` flag is added.

**Why:** A `0` score implies the visual evidence contradicts the submission — which is different from having no visual evidence at all. Using `null` preserves data integrity and allows the admin to correctly interpret the AI's confidence score.

---

## 7. Output Schema Enforcement

**Design Decision:** The agent is instructed to return **only JSON** with no additional prose.

**Why:** The AI's output is consumed directly by Bekoe's backend endpoint (`POST /api/game-proposals/:id/ai-review`). Any unstructured text outside the JSON block would break parsing. Strict output enforcement prevents formatting drift across API calls and model versions.

---

## 8. Questions for Team Review

> [!IMPORTANT]
> Please review and provide feedback on the following before Day 2 implementation:

1. **Scoring Thresholds**: Are `approved ≥ 0.8`, `manual_review 0.5–0.79`, `declined < 0.5` the right cutoffs? Should we pilot with a wider `manual_review` band (e.g. 0.4–0.89)?
2. **Enriched Data Usage**: Should enriched descriptions/FAQs be auto-saved to the proposal, or only shown to the admin for manual copy-paste?
3. **Screenshot Quality**: What minimum resolution/viewport should Harriet target to ensure the Vision model can identify the game reliably?
4. **Retry Prompting**: When an admin declines and provides feedback, should the retry prompt reference the original metrics scores or only the admin's feedback text?
