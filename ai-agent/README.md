# ArcadeBox AI Review + SEO Agent

FastAPI + LangGraph service for ArcadeBox that verifies a game visually, grounds content against PostgreSQL and MongoDB, runs plan and draft validation, and returns a structured AI review payload.

## Current Pipeline

```text
Webhook / Cron / Direct Agent Run
  -> In-memory job queue
  -> Stage 0 Capture
  -> Stage 0 Visual Verification
  -> Stage 1 SEO Intelligence
  -> Stage 2 Grounded Retrieval
  -> Stage 3 Architect
  -> Stage 4 Critic
  -> Stage 5 Scribe
  -> Stage 6 Auditor
  -> Stage 7 Optimizer
  -> AI review mapping
  -> Optional review writeback
```

The service supports two entry modes:

- proposal-driven runs from the ArcadeBox main app
- direct `game_id` runs for internal agent execution and LangGraph development

## API

### Health

- `GET /health`
- `GET /health/live`

### Proposal Intake

- `POST /webhook/proposal-created`

Queues a proposal review job. The service fetches the proposal from the main app and writes the final `aiReview` payload back through the current proposal update contract.

### Direct Agent Runs

- `POST /agent/run`

Request body:

```json
{
  "game_id": "uuid",
  "submit_review": false
}
```

This enqueues a full end-to-end agent run using only the canonical game record.

### Job Status

- `GET /jobs`
- `GET /jobs/{job_id}`

These endpoints expose queue status, timestamps, errors, and the final result payload for direct and proposal-backed jobs.

### Stage 0

- `POST /stage0/run`
- `GET /stage0/{game_id}/result`
- `GET /stage0/{game_id}/comparison-scores`
- `GET /stage0/{game_id}/research-findings`
- `GET /stage0/{game_id}/candidates`

## Architecture

```text
app/
├── api/                     FastAPI routers
├── config/                  env-backed settings + runtime config dataclasses
├── domain/                  DTOs and API schemas
├── infrastructure/          DB, browser, LLM, external API, storage adapters
├── services/                global queue, job store, observability
└── workflows/ai_review_agent/
    ├── workflow.py          LangGraph orchestration
    ├── context.py           graph state contract
    ├── nodes/               one file per stage
    └── services/            workflow-local logic
```

## LangGraph Development

The repository includes [langgraph.json](./langgraph.json) and [app/langgraph_entry.py](./app/langgraph_entry.py) so the graph can run under the LangGraph dev server.

Local commands:

```bash
pip install -r requirements.txt
playwright install chromium
uvicorn app.main:app --reload --port 8000
```

For LangGraph local dev:

```bash
venv/bin/langgraph dev
```

The default LangGraph dev server port is `2024`. The graph name is `ai_review_agent`.
If you use a globally installed `langgraph` CLI instead of the project virtualenv, you can hit package-version mismatches between `langgraph-api` and `langgraph-runtime-inmem`.

## Environment Setup

Copy `.env.example` to `.env`. The example file now matches the codepath used by:

- FastAPI runtime
- LangGraph dev
- Stage 0 browser capture
- Stage 2 Mongo/Postgres grounding
- Stage 7 optimizer evaluation persistence

Important variables:

- `ARCADE_API_BASE_URL`
- `ARCADE_API_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_WEB_SEARCH_MODEL`
- `DATABASE_URL` or `DB_*`
- `MONGODB_URL`
- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORD`
- `MAX_PLAN_REVISIONS`
- `MAX_DRAFT_REVISIONS`

The app accepts both `LANGCHAIN_*` and `LANGSMITH_*` observability aliases.

### Creating the Environment

```bash
# Create a virtual environment
python3 -m venv venv

# Activate the environment
source venv/bin/activate
```

### Installing Dependencies

```bash
# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Updating and Freezing Requirements

When adding new dependencies, update and freeze the requirements:

```bash
# Add new package
pip install <package-name>

# Update requirements.txt
pip freeze > requirements.txt
```

Alternatively, use pip-tools for more controlled dependency management:

```bash
# Install pip-tools if not already installed
pip install pip-tools

# Generate requirements.in from your imports
pip-compile -o requirements.in

# Compile to requirements.txt with pinned versions
pip-compile requirements.in -o requirements.txt
```

## Current Limits

- Queue and job storage are still in-memory only.
- Review writeback still depends on the existing proposal update contract, not a dedicated AI review endpoint.
- The agent is end-to-end in code, but external correctness still depends on live Playwright access, DB connectivity, OpenAI responses, and the main app contract.

## Verification

Current local verification:

```bash
python3 -m compileall app tests scripts
python3 -m unittest discover -s tests
```
