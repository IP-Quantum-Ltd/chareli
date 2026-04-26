# ArcadeBox AI Review + SEO Agent — Functional Specification

> Version: 1.2  
> Status: Implemented foundation  
> Last Updated: 26 April 2026

## 1. Objective

Build a visual-first LangGraph agent that:

1. verifies the game identity before any downstream drafting
2. generates grounded review and SEO artifacts from deterministic and semantic data sources
3. validates the plan and the final draft before marking the run complete
4. exposes both proposal-triggered and direct `game_id` execution

Unknown facts must remain unknown. Unsupported claims are treated as draft defects.

## 2. Runtime Entry Modes

The service supports two execution paths:

1. Proposal workflow
   `POST /webhook/proposal-created` or cron scan of pending proposals
2. Direct agent workflow
   `POST /agent/run` with only `game_id`

Both flows create an internal job record and execute the same LangGraph workflow.

## 3. Implemented 8-Step Workflow

```text
Queue job
  -> Capture
  -> Visual Verify
  -> SEO Analyze
  -> Grounded Retrieve
  -> Plan Content
  -> Critic Plan
  -> Draft Content
  -> Audit Content
  -> Optimize Content
```

### Stage 0: Capture

- capture internal thumbnail and gameplay references from ArcadeBox
- store artifact paths and capture metadata

### Stage 0: Visual Verify

- run multimodal web search
- capture candidate pages
- score textual and visual correlation
- persist comparison scores, findings, and manifest artifacts

### Stage 1: SEO Analyze

- derive keyword targets
- derive search intent and entity expectations
- derive FAQ opportunities and metadata hints

### Stage 2: Grounded Retrieve

- read canonical relational data from PostgreSQL
- search semantic and vector context in MongoDB
- persist best-match grounding back into MongoDB
- synthesize a grounded context packet

### Stage 3: Plan Content

- generate a JSON content outline from verified facts, grounded context, and SEO strategy

### Stage 4: Critic Plan

- validate outline coverage against grounded facts and Stage 1 entities
- send revision instructions back to the planner when required

### Stage 5: Draft Content

- produce markdown from grounded facts, outline, and revision feedback

### Stage 6: Audit Content

- compare the draft against grounded evidence
- reject unsupported claims
- send revision instructions back to the scribe when required

### Stage 7: Optimize Content

- generate meta title, meta description, H1 guidance, and FAQ schema
- compute evaluation signals
- persist evaluation payloads to MongoDB

## 4. Revision Loop Rules

- Critic failures route back to the Architect until `MAX_PLAN_REVISIONS` is reached.
- Auditor failures route back to the Scribe until `MAX_DRAFT_REVISIONS` is reached.
- If either limit is exceeded, the pipeline fails and the job record captures the error.

## 5. Job Model

Each run creates an in-memory job record with:

- `job_id`
- `job_type`
- `target_id`
- `status`
- timestamps
- error message
- final result payload

Job APIs:

- `GET /jobs`
- `GET /jobs/{job_id}`

## 6. Main Contracts

### Proposal intake

- `POST /webhook/proposal-created`

### Pending proposal fallback

- `GET /api/game-proposals/pending`

### Review writeback

- `PUT /api/game-proposals/:id`
- payload shape:
  `{ "proposedData": { "aiReview": ... } }`

### Direct agent execution

- `POST /agent/run`

## 7. LangGraph Local Development

The repository includes:

- `langgraph.json`
- `app/langgraph_entry.py`

This allows local graph execution through:

```bash
langgraph dev
```

The exposed graph id is `ai_review_agent`.

## 8. Environment Contract

The runtime currently requires:

- ArcadeBox API access
- OpenAI access
- PostgreSQL access
- MongoDB access
- browser admin credentials

The `.env.example` file is now aligned with the settings model and includes:

- `OPENAI_WEB_SEARCH_MODEL`
- `MONGODB_EVALUATION_COLLECTION`
- browser viewport and timeout controls
- revision limits
- job retention
- both `LANGCHAIN_*` and `LANGSMITH_*` tracing aliases

## 9. Remaining Gaps

- Queue and job storage are still in-memory only.
- Review writeback still depends on the existing proposal update route.
- End-to-end quality still depends on live external systems and has not been stress-tested at scale.
