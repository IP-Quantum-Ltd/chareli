# ArcadeBox AI Game Review Agent

FastAPI microservice that analyzes new game submissions and sends a structured AI review back to the main ArcadeBox app. The current live flow uses a visual-first verification gate before any SEO drafting happens.

---

## How It Works

```
New GameProposal created
        |
        +-> Webhook: POST /webhook/proposal-created
        |
        +-> Cron fallback scan: GET /api/game-proposals/pending
                        |
               In-memory job queue (dedup by proposalId)
                        |
               Stage 0: Internal gameplay capture
               Playwright captures two gameplay frames from ArcadeBox
                        |
               Stage 0: Visual Librarian
               Browser search -> external page screenshots -> visual correlation
                        |
               Stage 1: SEO intelligence
                        |
               Stage 2: grounded retrieval
               PostgreSQL metadata + MongoDB context packet
                        |
               Stage 3+: outline -> draft generation
                        |
               Submit structured AI review back to main app
```

---

## Stage 2 Explained

Stage 2 is the librarian layer. Its job is to turn the verified Stage 0 match and the Stage 1 SEO blueprint into a grounded context packet for writing.

Why PostgreSQL exists in Stage 2:
- PostgreSQL is for structured, authoritative metadata.
- It is where we want exact fields such as game title, slug, developer, publisher, category, instructions, rules, tags, or other canonical records when they exist.
- In practice, this gives us deterministic grounding instead of relying only on scraped web copy.

Why MongoDB also exists in Stage 2:
- MongoDB is for broader search-oriented context.
- It is better suited for semi-structured summaries, chunked knowledge, vector-search style content, and previously enriched documents.
- This helps us retrieve supporting text that is useful for FAQ, how-to-play sections, and related context.

Why we need both:
- PostgreSQL answers: "What is the canonical structured record?"
- MongoDB answers: "What supporting context and searchable knowledge do we already have?"
- Together they reduce hallucination and give Stage 3 and Stage 5 a better evidence base than web screenshots alone.

Current Stage 2 behavior:
- It derives retrieval queries from Stage 0 and Stage 1.
- It saves the highest-confidence verified match into a dedicated Mongo RAG collection with an embedding.
- It tries MongoDB Atlas vector search against that collection first.
- It searches PostgreSQL for matching structured records.
- It falls back to Mongo text retrieval if Atlas vector search is unavailable.
- It synthesizes both into one `grounded_context` packet for the downstream content stages.

Mongo vector-search note:
- The app expects a Mongo collection named by `MONGODB_RAG_COLLECTION`.
- It expects an Atlas vector index named by `MONGODB_VECTOR_INDEX`.
- If that index is missing, Stage 2 still works, but Mongo retrieval falls back to text search instead of true vector RAG.

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

Fill in:

| Variable | Description |
|---|---|
| `ARCADE_API_BASE_URL` | Main ArcadeBox API base URL |
| `ARCADE_API_TOKEN` | Non-expiry editor-role service account token |
| `AI_PROVIDER` | `openai` or `claude` |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key when using Claude |
| `PRIMARY_LLM_MODEL` | Main model for visual verification and drafting |
| `SECONDARY_LLM_MODEL` | Secondary model for lighter steps |
| `EMBEDDING_MODEL` | Embedding model used by Stage 2 retrieval/reranking |
| `DATABASE_URL` | Optional direct Postgres DSN for Stage 2 |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | Postgres connection parts if `DATABASE_URL` is not used |
| `MONGODB_URL` | MongoDB connection string for Stage 2 |
| `MONGODB_DB_NAME` | MongoDB database name |
| `MONGODB_RAG_COLLECTION` | Mongo collection used for persisted Stage 0/2 grounded documents |
| `MONGODB_VECTOR_INDEX` | Atlas vector index name used for Stage 2 RAG retrieval |
| `CLIENT_URL` | ArcadeBox client URL used for gameplay capture |
| `SUPERADMIN_EMAIL` | Browser-agent environment requirement |
| `SUPERADMIN_PASSWORD` | Browser-agent environment requirement |
| `WEBHOOK_SECRET` | Shared secret for inbound webhooks |
| `CRON_INTERVAL_MINUTES` | Fallback scan interval |
| `LANGCHAIN_TRACING_V2` | Enables LangSmith tracing |
| `LANGCHAIN_API_KEY` | LangSmith API key |
| `LANGCHAIN_PROJECT` | LangSmith project name |

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
| `POST` | `/webhook/proposal-created` | Enqueues a proposal for asynchronous AI processing |

---

## Project Structure

```
ai-agent/
|-- app/
|   |-- main.py
|   |-- config.py
|   |-- db/
|   |   |-- mongo.py
|   |   `-- postgres.py
|   |-- models/
|   |   `-- schemas.py
|   |-- routers/
|   |   |-- health.py
|   |   `-- webhook.py
|   `-- services/
|       |-- agent.py
|       |-- arcade_client.py
|       |-- browser_agent.py
|       |-- graph_orchestrator.py
|       |-- librarian_agent.py
|       |-- task_queue.py
|       `-- visual_librarian.py
|-- requirements.txt
|-- .env.example
|-- Dockerfile
`-- docker-compose.yml
```

---

## Main App Configuration

Add this to the main ArcadeBox server `.env`:

```env
AI_AGENT_WEBHOOK_URL=http://localhost:8000
```

Leave it empty to disable AI notifications without breaking the main app.
