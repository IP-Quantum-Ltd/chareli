# Game Evaluation Metrics & Scoring Thresholds
**Project:** ArcadeBox AI Game Review Agent | **Version:** 1.2

> [!IMPORTANT]
> Not all submissions will have every field populated. Each metric has two scoring paths: one for when data is **present** (cross-reference) and one for when data is **missing** (discover & enrich).

## Metric Definitions

| Metric | If Data is Present | If Data is Missing |
|---|---|---|
| **Title Authenticity** | Cross-reference the submitted title against web results and the screenshot. Does it match? | Use the screenshot to identify the game's true/common title via web search. |
| **Developer Credibility** | Verify the submitted developer name has a real web presence (itch.io, Steam, website). | Search the web by game title/screenshot to discover the developer. Score based on what is found. |
| **Description Quality** | Compare the submitted description against details found on the web. Are claims accurate? | Use web search to find and extract the official description. Populate `enriched_data`. |
| **Category Accuracy** | Check if the submitted category matches how the game is classified on external platforms. | Determine the correct genre from web findings and screenshot. Populate `enriched_data`. |
| **Data Consistency** | Verify that all submitted fields (title, dev, description) are internally consistent AND match web data. | Assess consistency between the screenshot and any data discovered during web search. |
| **Visual-Metadata Alignment** | Compare the submitted screenshot against web visuals for the same game. Do they match? | Compare screenshot against web images of the game identified by title/web search. |

## Scoring Scale

Each metric is scored **0.0 – 1.0**.

| Score Range | Meaning |
|---|---|
| **0.8 – 1.0** | Verified and consistent with external sources |
| **0.5 – 0.79** | Partially verified; some uncertainty |
| **0.3 – 0.49** | Significant discrepancy or insufficient data found |
| **0.0 – 0.29** | 🚩 Red flag — direct contradiction or zero data found |

## Decision Thresholds

| Result | Condition |
|---|---|
| `approved` | Average ≥ 0.8 AND no metric < 0.6 |
| `manual_review` | Average 0.5–0.79 OR any single metric < 0.6 |
| `declined` | Average < 0.5 OR any metric scores 0.0–0.29 |
