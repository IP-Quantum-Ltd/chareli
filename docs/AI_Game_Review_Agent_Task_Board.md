# AI Game Review Agent — Task Board
**Sprint:** March 30 – April 3, 2026 (5 Business Days)
**Project:** ArcadeBox AI Game Review Agent
**Version:** 1.0

---

## Team

| Member | Role |
|---|---|
| Victoria Nyamadie | Data Analyst, LLM Engineer & Researcher |
| Harriet Fiagbor | ML & LLM Engineer |
| Bekoe Isaac | Fullstack Developer |

---

## Status Legend

| Symbol | Status |
|---|---|
| `[ ]` | To Do |
| `[~]` | In Progress |
| `[x]` | Done |
| `[!]` | Blocked |

---

## Day 1 — Monday, March 30, 2026
**Theme: Foundations & Setup**

### Bekoe Isaac — Fullstack Developer
- [ ] Scaffold FastAPI microservice project (folder structure, virtual env, dependencies)
- [ ] Add webhook emitter to main app on `GameProposal` creation (`proposal.created` event)
- [ ] Design and implement `POST /api/game-proposals/:id/ai-review` endpoint on main app
  - Accepts: `{ recommendation, reasoning, metrics, attempt_number }`
  - Stores AI review data on the proposal
  - Admin-visible in proposal detail view
- [ ] Generate non-expiry service account token (admin/viewer role) for the AI microservice
- [ ] Set up `.env` config for FastAPI (main app base URL, API token, OpenAI key)

### Victoria Nyamadie — Data Analyst, LLM Engineer & Researcher
- [ ] Finalise evaluation metric definitions and scoring thresholds based on Research Report
  - Title Authenticity, Developer Credibility, Description Quality, Category Accuracy, Data Consistency, Visual-Metadata Alignment
- [ ] Define structured output schema for AI recommendation (JSON)
  - `recommendation`, `reasoning`, `metrics_scores`, `flags`, `confidence_score`
- [ ] Draft reviewer persona and system prompt (v1) for the Web Search Agent
- [ ] Document prompt structure and rationale for team review

### Harriet Fiagbor — ML & LLM Engineer
- [ ] Set up Agent 1 (Browser Agent) — Playwright environment and dependencies
- [ ] Implement authenticated session management for the Arcade platform
- [ ] Implement game preview page navigation by `proposalId` / `gameId`
- [ ] Implement screenshot capture from rendered game HTML page
- [ ] Test screenshot output quality on 2–3 sample games

---

## Day 2 — Tuesday, March 31, 2026
**Theme: Agent Core Logic**

### Bekoe Isaac — Fullstack Developer
- [ ] Implement FastAPI webhook receiver endpoint (`POST /webhook/proposal-created`)
  - Validates payload, pushes to processing queue
- [ ] Implement cron job (`GET /api/game-proposals?status=pending`) as fallback scan
  - Runs every 15 minutes
  - Deduplicates by `proposalId` (skip already-queued or processed)
- [ ] Implement in-memory or Redis-backed job queue with `proposalId` dedup
- [ ] Wire queue worker to call the AI pipeline (stub for now)

### Victoria Nyamadie — Data Analyst, LLM Engineer & Researcher
- [ ] Implement Agent 2 (Web Search Agent) using OpenAI Responses API
  - Multimodal input: screenshot (base64) + `proposedData` text
  - Web search tool enabled for external verification
- [ ] Implement metric scoring logic (per evaluation metric)
- [ ] Implement recommendation generation with structured JSON output
- [ ] Unit test: verify structured output schema is consistently returned

### Harriet Fiagbor — ML & LLM Engineer
- [ ] Implement metadata extraction from proposal `proposedData` (title, description, developer, category, platform)
- [ ] Build Agent 1 → Agent 2 data handoff interface
  - Output: `{ screenshot_base64, metadata: {...} }`
- [ ] Handle Agent 1 failure gracefully: if screenshot fails, pass text-only payload to Agent 2 with a flag
- [ ] Add OpenAI / Claude provider toggle (env-based switch, no vendor lock-in)

---

## Day 3 — Wednesday, April 1, 2026
**Theme: Pipeline Integration & Retry Logic**

### Bekoe Isaac — Fullstack Developer
- [ ] Connect queue worker to full agent pipeline (Agent 1 → Agent 2 → submit review)
- [ ] Implement `POST /api/game-proposals/:id/ai-review` call from FastAPI after analysis
- [ ] Implement retry trigger: webhook or cron detects proposals with status `declined` + `adminFeedback` + `ai_attempt < 3`
- [ ] Implement retry pipeline: fetch decline feedback → pass to agent for revised analysis → resubmit
- [ ] Implement attempt counter tracking (store on proposal or in FastAPI state)

### Victoria Nyamadie — Data Analyst, LLM Engineer & Researcher
- [ ] Refine system prompt based on Day 2 test outputs
- [ ] Implement retry-aware prompt: inject `adminFeedback` from previous decline into next agent run
  - Prompt must reference prior reasoning and explicitly address admin feedback
- [ ] Test retry prompt on 3 simulated decline scenarios
- [ ] Document final prompt versions (v1 baseline + retry variant)

### Harriet Fiagbor — ML & LLM Engineer
- [ ] Full end-to-end pipeline test: Agent 1 capture → Agent 2 analysis → structured output
- [ ] Implement exponential backoff for OpenAI API rate limit / timeout errors
- [ ] Implement 3-attempt exhaustion flag: after 3 failed retries, mark proposal for manual attention
- [ ] Validate that provider toggle works correctly (OpenAI ↔ Claude swap without code changes)

---

## Day 4 — Thursday, April 2, 2026
**Theme: Dashboard Integration & Fail-Safes**

### Bekoe Isaac — Fullstack Developer
- [ ] Update admin proposal detail view to display AI review data
  - Show: recommendation, reasoning, metric scores, attempt number, confidence score
  - Visual label: "AI Generated Review" badge
- [ ] Add retry count indicator to proposal list and detail views
- [ ] Implement auto-flagging UI: proposals that exhaust all 3 AI attempts show a distinct "Needs Manual Review" flag
- [ ] Validate `POST /api/game-proposals/:id/ai-review` stores and retrieves correctly end-to-end

### Victoria Nyamadie — Data Analyst, LLM Engineer & Researcher
- [ ] Run evaluation on 5–10 real game proposals (or representative samples)
- [ ] Analyse metric score distributions — validate thresholds are well-calibrated
- [ ] Document any false positives / negatives with reasoning
- [ ] Prepare summary of AI performance findings for handover doc

### Harriet Fiagbor — ML & LLM Engineer
- [ ] Load and performance testing: simulate 10 concurrent proposal triggers
- [ ] Validate queue deduplication under concurrent webhook + cron triggers
- [ ] Test Agent 1 screenshot quality across different game types
- [ ] Confirm text-only fallback path works correctly when screenshot fails

---

## Day 5 — Friday, April 3, 2026
**Theme: Testing, QA & Handover**

### Bekoe Isaac — Fullstack Developer
- [ ] End-to-end integration test: new proposal → webhook → AI review → admin dashboard display
- [ ] End-to-end retry test: decline with feedback → AI resubmit → 3x exhaustion → flag
- [ ] Cron fallback test: disable webhook, verify cron picks up pending proposals
- [ ] Docker Compose / deployment config for FastAPI microservice
- [ ] Write technical handover notes (setup, env vars, endpoints, token rotation procedure)

### Victoria Nyamadie — Data Analyst, LLM Engineer & Researcher
- [ ] Final prompt QA — run against edge cases (minimal description, unknown developer, mismatched category)
- [ ] Validate structured output schema is stable across all test cases
- [ ] Write LLM/prompt documentation: prompt versions, metric definitions, scoring thresholds
- [ ] Review and sign off on AI recommendation quality for handover

### Harriet Fiagbor — ML & LLM Engineer
- [ ] Full pipeline regression test after all integrations
- [ ] Verify provider toggle in staging (OpenAI default, Claude fallback)
- [ ] Clean up Playwright session management (no leftover browser instances, memory leaks)
- [ ] Write agent architecture documentation (Agent 1 + Agent 2 data flow, failure modes)

---

## Milestone Summary

| Day | Milestone |
|---|---|
| EOD Day 1 | FastAPI scaffolded, main app webhook + ai-review endpoint live, Agent 1 capturing screenshots |
| EOD Day 2 | Agent 2 producing structured recommendations, queue + cron receiving proposals |
| EOD Day 3 | Full pipeline integrated end-to-end, retry logic with admin feedback working |
| EOD Day 4 | Admin dashboard showing AI reviews, fail-safe flagging in place |
| EOD Day 5 | All tests passing, deployment-ready, documentation complete |

---

## Key Dependencies & Notes

- **Token:** Non-expiry admin/viewer service token must be generated on Day 1 before any API calls can be tested
- **Webhook:** Main app webhook emitter (Bekoe, Day 1) is a hard dependency for Harriet's queue work on Day 2
- **AI Review Endpoint:** `POST /api/game-proposals/:id/ai-review` (Bekoe, Day 1) is a hard dependency for Victoria & Harriet's pipeline on Day 3
- **Provider Decision:** OpenAI confirmed as default per Research Report. Claude toggle built in but not primary.
- **Retry Trigger:** Retry is triggered when a proposal has status `declined` + non-null `adminFeedback` + AI attempt count < 3. FastAPI detects this via webhook (preferred) or cron scan.
- **Screenshot Fallback:** If Playwright fails to capture, Agent 2 proceeds with text-only analysis and flags `screenshot_available: false` in the output.

---

## Out of Scope (This Sprint)

- Reviewing game visual assets (thumbnails, videos) as part of metadata assessment
- Cross-game developer history or memory between submissions
- Direct AI-to-developer communication
- Auto-approval or auto-rejection by the AI (admin always has final authority)
