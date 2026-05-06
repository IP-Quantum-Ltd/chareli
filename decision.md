# Architectural Decision Log

Tracks significant architectural changes made to the chareli monorepo. Add an entry whenever a meaningful structural, tooling, or pipeline decision is made.

---

## [2026-05-04] Two-tier critic coverage score thresholds

**Decision:** Replaced the single `min_coverage_score=70` threshold in `CriticPlanNode` with two tiers: `min_coverage_score=60` (floor) and `best_coverage_score=70` (auto-approve).

**Why:** A single threshold at 70 was causing the pipeline to fail on games with weaker external matches (e.g. confidence 63) because the critic kept requesting revisions and coverage never reached 70, exhausting the revision budget. Separating the thresholds allows borderline plans (60–69) to proceed with warnings instead of failing, while plans scoring 70+ are auto-approved without needing LLM approval.

**Impact:** Both values are configurable via `CRITIC_MIN_COVERAGE_SCORE` and `CRITIC_BEST_COVERAGE_SCORE` in `.env`.

---

## [2026-05-04] Remove Drizzle ORM from Server

**Decision:** Remove `drizzle-orm`, `drizzle-kit`, the `db:studio` script, and `drizzle.config.ts` from the Server.

**Why:** Drizzle was installed but never integrated into the Server source code. TypeORM is the active ORM handling all queries and migrations. Having both installed created dead weight and potential confusion about which ORM to use.

**Impact:** TypeORM remains the sole ORM. All migrations continue to run via `npm run migration:run`. No runtime behaviour changed.

---

## [2026-05-04] Exclude external URLs from generated articles

**Decision:** Added an instruction to `content_drafting_service.py` telling the LLM not to include external URLs, links, or image references in the drafted article.

**Why:** The `source_url` from the best-matched candidate was being passed in the fact sheet, causing the LLM to embed external links and image markdown into the article body.

**Impact:** Articles no longer contain external links or image references. The `source_url` remains in the fact sheet for context but is not surfaced in the output.

---

## [2026-05-04] Remove admin login from gameplay capture

**Decision:** Removed the admin login flow from `capture_proposal_gameplay` in `internal_capture.py`. The browser now navigates directly to `{CLIENT_URL}/gameplay/{proposal_id}`.

**Why:** The `/gameplay/{id}` page on staging is publicly accessible — no authentication required. The login flow (load login page → fill credentials → submit → wait for redirect) added 4 unnecessary round trips before the game page was even loaded, causing consistent timeouts in WSL2.

**Impact:** Gameplay capture is faster and no longer depends on admin credentials. `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` are no longer used by the capture pipeline.

---

## [2026-05-04] Gameplay capture made mandatory in Stage 0

**Decision:** Gameplay screenshot capture in `internal_capture.py` is now mandatory. A failure or timeout raises an exception instead of being silently swallowed.

**Why:** The gameplay frame is passed alongside the thumbnail to every vision call in Stage 0 — game identity inference, web search, and candidate correlation scoring. Proceeding with only the thumbnail silently degrades match quality without any indication that a capture had failed.

**Impact:** If the browser cannot capture the gameplay page (login failure, timeout, page not loading), the pipeline fails fast at the capture stage rather than producing a lower-quality result downstream.

---

## [2026-05-04] Docker — multi-stage build with playwright/python:v1.49.0-noble

**Decision:** Rewrote `ai-agent/Dockerfile` as a two-stage build. Both builder and runtime stages use `mcr.microsoft.com/playwright/python:v1.49.0-noble` (Ubuntu 24.04, Python 3.12). The builder compiles pip wheels; the runtime installs from wheels then runs `playwright install chromium`. Added `ai-agent/.dockerignore`.

**Why:** The original single-stage build was large and slow. Earlier attempts with `jammy` (Ubuntu 22.04) failed because it ships Python 3.10 and `langgraph-api==0.0.48` requires Python ≥ 3.11. Using `noble` for both stages ensures wheel compatibility. The `.dockerignore` excludes venv, pycache, `.env`, test artifacts, and `.langgraph_api/` from the build context.

**Impact:** Smaller image, faster rebuilds via cached wheel layer. Python 3.12 throughout. Agent is deployed via Docker on ECS; local development runs directly via uvicorn in WSL2.

---

## [2026-04-28] Prompt compaction added to article drafting pipeline

**Decision:** Introduced `prompt_compaction.py` and wired it into `content_drafting_service`, `content_auditor_service`, `content_planning_service`, `content_critic_service`, `seo_optimizer_service`, `seo_analysis_service`, and `grounded_retrieval_service`.

**Why:** Reduce token usage by truncating large fact sheets before they reach the LLM. Strings are capped at 260 characters, lists at 8 items, dicts at 18 fields.

**Impact:** LLM receives less raw context per call. May reduce article depth. Candidate timeout threshold was separately raised to 60s to compensate for WSL2 latency.

---

## [2026-04-26] Full AI pipeline rewrite — old scribe_agent replaced

**Decision:** Replaced the original `scribe_agent.py` / `graph_orchestrator.py` pipeline with the `ai_review_agent` LangGraph workflow.

**Why:** The original pipeline did section-by-section RAG drafting against MongoDB vector search. The new pipeline uses a single-pass LLM call with a compacted fact sheet sourced from live web research (Stage 0 visual verification + SEO analysis + grounded retrieval).

**Impact:** Articles changed from clean prose assembled in Python (headings added by code, bodies written by LLM) to full Markdown articles written entirely by the LLM in one call. This introduced visible Markdown syntax (`#`, `**`, `-`) in the output string.

---

## [2026-04-26] Article format changed to Markdown-first

**Decision:** `content_drafting_service.py` instructs the LLM via system prompt: `"Respond with high-quality Markdown."` and user prompt ending: `"Return the full Markdown article."`

**Why:** Intended to produce structured, SEO-ready content.

**Impact:** Articles are returned as raw Markdown strings. Any display surface that does not render Markdown will show `#`, `**`, etc. as literal characters. The previous pipeline produced prose that appeared as plain text.

---

## [2026-04-20] Original pipeline

**Decision:** Initial AI agent implemented using `scribe_agent.py` / `graph_orchestrator.py` with MongoDB Atlas vector search for RAG-based section drafting.

**Why:** First implementation of the automated game review and article generation system.

**Impact:** Established the LangGraph orchestration pattern, MongoDB knowledge store, and LangSmith tracing integration that the rewritten pipeline still builds on.
