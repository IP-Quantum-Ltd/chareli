# ArcadeBox AI Game Review Agent

FastAPI microservice that automatically analyses new game submissions and generates review recommendations for the admin to evaluate. The AI never approves or rejects games independently — it provides a recommendation and reasoning only.

---

## How It Works

```
New GameProposal created (by editor on main app)
        │
        ├─→ Webhook: POST /webhook/proposal-created  ← immediate trigger
        │
        └─→ Cron (every 15 min): GET /api/game-proposals/pending  ← fallback scan
                        │
               In-memory job queue (dedup by proposalId)
                        │
              Agent 1 — Playwright (Harriet)
              Navigate to game preview → capture screenshot
                        │
              Agent 2 — OpenAI Web Search (Victoria)
              Screenshot + proposedData → verify → score metrics → recommendation
                        │
              Submit review back to main app via editor token
```

---

## Setup

### 1. Install dependencies

```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description |
|---|---|
| `ARCADE_API_BASE_URL` | Main ArcadeBox API base URL (e.g. `https://api.arcadesbox.com`) |
| `ARCADE_API_TOKEN` | Non-expiry editor-role service account token |
| `AI_PROVIDER` | `openai` (default) or `claude` |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key (only needed if `AI_PROVIDER=claude`) |
| `WEBHOOK_SECRET` | Shared secret to validate inbound webhooks from the main app |
| `CRON_INTERVAL_MINUTES` | How often the fallback cron scans for pending proposals (default `15`) |

### 3. Run locally

```bash
uvicorn app.main:app --reload --port 8000
```

### 4. Run with Docker

```bash
docker compose up --build
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/webhook/proposal-created` | Inbound webhook from main app (requires `X-Webhook-Secret` header if `WEBHOOK_SECRET` is set) |

---

## Project Structure

```
ai-agent/
├── app/
│   ├── main.py                  # FastAPI app, lifespan, cron scheduler, queue worker
│   ├── config.py                # Settings loaded from .env
│   ├── models/
│   │   └── schemas.py           # Pydantic schemas (webhook payload, review result)
│   ├── routers/
│   │   ├── health.py            # GET /health
│   │   └── webhook.py           # POST /webhook/proposal-created
│   └── services/
│       ├── queue.py             # In-memory dedup job queue
│       ├── arcade_client.py     # HTTP client for main ArcadeBox API
│       └── agent.py             # AI pipeline (Agent 1 + Agent 2)
├── requirements.txt
├── .env.example
├── Dockerfile
└── docker-compose.yml
```

---

## Main App Configuration

On the main ArcadeBox Server, add this to `.env`:

```
AI_AGENT_WEBHOOK_URL=http://localhost:8000   # or deployed URL
```

This tells the main app where to send the `proposal.created` webhook. Leave it empty to disable AI notifications without breaking anything.

---

## Retry Logic

When an admin declines a proposal with feedback:

1. The cron scan picks up the declined proposal (status `declined` + `adminFeedback` present)
2. The agent reads the feedback and re-runs the pipeline, injecting the admin's comments into the prompt
3. This repeats up to **3 attempts**
4. After 3 failed attempts the proposal is flagged for manual review

> Retry implementation: Day 3 (Bekoe + Harriet)

---

## AI Provider Toggle

Switch between OpenAI and Claude without any code changes — just update `.env`:

```
AI_PROVIDER=openai   # default
AI_PROVIDER=claude   # fallback
```

> Provider toggle implementation: Day 2 (Harriet)
