# Chareli / ArcadeBox — Engineering Handoff

**Author:** Christian Koranteng (departing engineer)
**Audience:** Incoming engineer, plus reviewers (senior staff engineer, Codex)
**Repo state at time of writing:** branch `main`, HEAD `57a129e` (`chore: update dependencies for nodemailer and pm2; remove unused drizzle packages`)
**Date:** 2026-05-07

This document is the single source of truth for getting productive on this codebase. It does **not** restate what's already documented well elsewhere — it points to those documents and fills in the gaps (architecture context across the three runtime services, in-flight work, gotchas, ownership boundaries, repo housekeeping). Every claim is grounded in a file you can open. **Read §1 first.**

---

## Table of contents

1. [Read these in order before touching anything](#1-read-these-in-order-before-touching-anything)
2. [What this product is](#2-what-this-product-is)
3. [The three runtime services](#3-the-three-runtime-services)
4. [Local development setup](#4-local-development-setup)
5. [Existing documentation map](#5-existing-documentation-map)
6. [Subsystem catalog](#6-subsystem-catalog)
7. [Deployment and infrastructure](#7-deployment-and-infrastructure)
8. [CI/CD](#8-cicd)
9. [Testing](#9-testing)
10. [Work in flight as of 2026-05-07](#10-work-in-flight-as-of-2026-05-07)
11. [Known gotchas the codebase will not warn you about](#11-known-gotchas-the-codebase-will-not-warn-you-about)
12. [External dependencies and ownership boundaries](#12-external-dependencies-and-ownership-boundaries)
13. [First-week onboarding plan](#13-first-week-onboarding-plan)
14. [Repo housekeeping — stale files and orphaned branches](#14-repo-housekeeping--stale-files-and-orphaned-branches)
15. [Open questions](#15-open-questions)
16. [Access and contacts](#16-access-and-contacts)

---

## 1. Read these in order before touching anything

Three files contain the most leverage per minute of reading:

1. **`CLAUDE.md`** (repo root) — the working developer's orientation. Repo shape, command reference, architectural essentials, commit conventions, and behavioural guidelines. The new engineer can largely follow these guidelines too — the wording is generic enough.
2. **`AGENTS.md`** (repo root) — ten design choices that look like bugs but aren't. Includes sanity-probe `grep` counts you can run today to confirm the invariants haven't drifted (e.g., `grep -c "NOT IN (:...excludedRoles)"` should be 28). Read this before touching analytics, caching, admin exclusion, or the dashboard.
3. **`docs/internal_dashboard_analytics.md`** — the single best document in the repo. End-to-end architecture of the analytics + admin dashboard with file:line citations, the metric catalog, the admin-exclusion invariant, and a status table of the pre-polish review issues (most fixed, some deliberately deferred).

After those three, read in this order based on what you'll be touching:

- Working on analytics or dashboard → `docs/ga4_vs_dashboard.md`, `docs/zaraz_setup_runbook.md`, `docs/analytics_audit.md`.
- Working on file uploads or game pipeline → `docs/upload_optimization_analysis.md`, `Server/docs/cdn-urls.md`, `Server/docs/json-cdn-implementation.md`.
- Working on the AI review service → `ai-agent/README.md`, `docs/AI_Game_Review_Agent_Task_Board.md`.
- Working on tests → `TESTING_SETUP.md` (slightly dated; treat as directional).

`README.md` and `Server/README.md` exist but are out of date — do not trust them as your source of truth. The Server README still says "Simple Express.js backend" and lists S3 only, with no mention of R2, BullMQ, the storage abstraction, or the queue workers.

---

## 2. What this product is

**Arcadesbox / Chareli** is a web gaming platform: anonymous and registered users browse a catalogue of HTML5 games, click into a game, and play it inside an iframe. Game files (HTML/JS/asset bundles delivered as ZIPs) are uploaded by admins, processed asynchronously, and served from a CDN with signed-cookie authentication. Admins use an in-house dashboard for KPIs (visitors, players, sessions, retention, etc.) that is the source of truth for product/billing decisions. GA4 + Meta Pixel run on production for marketing/attribution.

Production hostnames: `arcadesbox.com`, `www.arcadesbox.com`. Staging: `api-staging.arcadesbox.com`, `staging.cdn.arcadesbox.org`. Note that **staging login uses `identifier`, not `email`** (different field name from prod — easy gotcha when scripting).

The user-visible product surface is small (home, gameplay, categories, signup, admin dashboard). The complexity is mostly in the analytics, the storage abstraction, the multi-tier caching, and — most recently — the AI review agent.

---

## 3. The three runtime services

This is the single most important context that the existing docs don't surface clearly. **There are three independent runtime services in this repo, in three different languages.**

### 3.1 `Server/` — Express + TypeScript (Node 22)

The main API. Runs on port 5000 in dev. Express 5, TypeORM (PostgreSQL), Redis + BullMQ, Socket.io, Swagger at `/api-docs`. Production runs under PM2 clustering inside an ECS Fargate task. Entry point: `Server/src/index.ts`. App configuration / middleware chain: `Server/src/app.ts:1-120`.

Middleware order (don't reorder casually — many invariants depend on it): `requestId` → `requestLogger` → `crawlProtection` → `helmet` → CORS → CSP header → JSON parsing → 25-minute timeout for `/api/games` POST/PUT (long uploads) → `sanitizeInput` → Swagger → routes → `errorHandler`.

CORS allows: `config.app.clientUrl`, `localhost:5173`, `localhost:3000`, `staging.arcadesbox.com`, `arcadesbox.com`, `www.arcadesbox.com`, and `*.pages.dev` (Cloudflare Pages previews). Custom headers: `X-Webhook-Secret`, `X-Idempotency-Key`, `X-Attempt` — these are for the **Cloudflare Worker** webhook callbacks (see §6.6).

### 3.2 `Client/` — React 19 + Vite

The SPA. Runs on port 5173 in dev. React 19, Vite, TypeScript, Tailwind 4, Radix UI, Redux Toolkit + TanStack Query (both — Redux for cross-cutting state, Query for server state), React Router 7, Socket.io-client, Uppy (direct uploads to R2/S3), Recharts (dashboard), Tiptap (rich text in admin), pdfmake/xlsx (export). Build outputs to `Client/dist/`, deployed to Cloudflare Pages.

Notable: **three form libraries are in dependencies** (`react-hook-form`, `formik`, `yup` plus `zod` for schemas). When adding a form, prefer `react-hook-form` + `zod` (the convention on the recent admin work). The Formik pages are older.

### 3.3 `ai-agent/` — Python FastAPI + LangGraph

A separate service (port 8000) that performs AI-powered review of new game proposals — Stage 0 visual capture (Playwright), Stage 1 SEO intelligence, Stage 2 grounded retrieval (Postgres + Mongo), Stages 3–7 architect/critic/scribe/auditor/optimizer using OpenAI Responses API. Implemented as a LangGraph workflow. Calls back into the main app's `POST /api/game-proposals/:id/ai-review` endpoint to write its output. Token-authenticated via a non-expiry service-account JWT (created with `Server/scripts/generate-service-token.ts`; see also untracked `Server/scripts/create-ai-agent-user.ts`).

It is its own Docker image, has its own `docker-compose.yml`, deploys via the `release.yml` and `staging.yml` workflows alongside the main server, and **shares the Postgres database with the Node Server**. It's recent work — the v1 sprint ran March 30 – April 3 2026; the `feat/ai-agent-deploy` PR landed 2026-04-30 (`1d7a14f1`); a follow-up `feat/visual-seo-agent` branch (`origin/feature/add-visual-seo-agent`, last commit 2026-04-28 by harrietfiagbor) is still active and has not merged.

Read `ai-agent/README.md` and `docs/AI_Game_Review_Agent_Task_Board.md` before touching this service. The team listed there (Victoria Nyamadie, Harriet Fiagbor, Bekoe Isaac) is the IP-Quantum team that owns the AI agent — not us.

### 3.4 `Server/workers/game-zip-processor/` — Cloudflare Worker

A **fourth** runtime, easy to miss. This is a Cloudflare Worker (TypeScript, deployed via Wrangler) that processes uploaded game ZIPs out-of-process from the main API. It has its own `package.json`, `wrangler.toml`-equivalent config, and is deployed by the `deploy-worker` job in `.github/workflows/dev.yml` (and the equivalents in staging/release). It calls back into the main API via the `X-Webhook-Secret` / `X-Idempotency-Key` headers to report status. **Don't confuse this with `Server/src/workers/gameZipProcessor.ts` — that's an in-process BullMQ worker. The Cloudflare Worker is the production path; the BullMQ one is fallback / older code. This duplication is real and someone should reconcile it eventually.**

---

## 4. Local development setup

Each project is independent. There is no root workspace manifest — `cd` into the project before running anything.

### 4.1 Prerequisites

- **Node 22** (the workflows pin this; older Node may build but won't catch the same TS surface).
- **PostgreSQL 14+** (the migrations target Postgres-specific features: `internal` schema, UUID, partial indexes).
- **Redis 7** (BullMQ + caching + rate limiting). The Server gracefully falls back to in-memory rate limiting if Redis is down, but BullMQ does not — analytics writes will fail hard without Redis.
- **Python 3.12** + Playwright Chromium (only for `ai-agent/`).
- **Docker** (only if running `ai-agent/` via compose, or building images locally).

### 4.2 Server

```bash
cd Server
cp .env.example .env       # if present; otherwise compose by hand — see secrets list in task-def.json
npm install
npm run migration:run      # applies the 44 migrations in src/migrations/
npm run dev                # nodemon → ts-node, port 5000
```

`npm run dev` boots the API. Swagger UI is at `http://localhost:5000/api-docs`. The first time the cache is empty, the dashboard will be slow — `npm run warm-cache` precomputes the dashboard cache (also runs after deploy in CI).

If migrations fail because the `internal` schema doesn't exist yet, create it once: `psql -d chareli_db -c 'CREATE SCHEMA IF NOT EXISTS internal;'`. The first migration that hits this schema is `1769488032602-Phase2AnalyticsSchema.ts`.

### 4.3 Client

```bash
cd Client
cp .env.example .env       # confirm VITE_API_URL points to your local backend
npm install
npm run dev                # vite, port 5173
```

Notable env vars in `.env`:
- `VITE_API_URL` — backend base URL (default `http://localhost:5000`)
- `VITE_GAMES_CDN_URL` — game asset CDN base
- `VITE_CDN_BASE_URL` — JSON CDN (optional, falls back to API)
- `VITE_CDN_ENABLED=true|false` — toggle JSON CDN consumption
- `VITE_OFFICIAL_DOMAIN` — used by `RootLayout.tsx` for canonical tags

### 4.4 ai-agent

```bash
cd ai-agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env       # set ARCADE_API_BASE_URL, ARCADE_API_TOKEN, OPENAI_API_KEY, DB_*, MONGODB_URL
uvicorn app.main:app --reload --port 8000
```

For LangGraph dev server: `venv/bin/langgraph dev` (port 2024, graph name `ai_review_agent`). Note: the README specifically warns about pkg-version mismatches if you use a globally-installed `langgraph` CLI; always use the project venv.

### 4.5 Common dev gotchas

- **Email/OTP locally**: SES is the production email provider but locally Twilio (SMS) and SendGrid/Resend/Nodemailer can all be wired in. Three email providers are in `Server/package.json` because the system was migrated incrementally; the active one is determined at runtime by env var. If signup OTP doesn't arrive, check which provider is selected and whether the credentials are present.
- **Storage in dev**: set `STORAGE_PROVIDER=local` to write game files to the local filesystem under `Server/dist/uploads/`. `s3` and `r2` need credentials. The interface is unified at `Server/src/services/storage.interface.ts` — three adapters: `local.storage.adapter.ts`, `s3.storage.adapter.ts`, `r2.storage.adapter.ts`.
- **Migrations are append-only**: never edit a committed migration. Use `npm run migration:generate -- src/migrations/Name` to scaffold one from entity diffs.

---

## 5. Existing documentation map

| File | What it gives you | Read before touching… |
| :--- | :--- | :--- |
| `CLAUDE.md` | Repo orientation, conventions, behavioural rules | Anything |
| `AGENTS.md` | 10 deliberate design choices + sanity grep probes | Analytics, caching, admin exclusion |
| `README.md` | High-level pitch — **partially stale** | Nothing load-bearing |
| `TESTING_SETUP.md` | Test philosophy + commands — **last updated 2025-09** | Tests |
| `docs/internal_dashboard_analytics.md` | Full analytics + dashboard architecture | Analytics, dashboard, admin queries |
| `docs/ga4_vs_dashboard.md` | Stakeholder-facing "why these don't match" | Analytics conversations w/ non-engineers |
| `docs/zaraz_setup_runbook.md` | Cloudflare-side configuration runbook | GA4/Ads/Pixel events |
| `docs/analytics_audit.md` | 2026-04-17 audit of the analytics surface | Analytics — context only |
| `docs/upload_optimization_analysis.md` | Upload pipeline diagnosis + optimisation list | File upload work |
| `docs/AI_Game_Review_Agent_Task_Board.md` | AI agent v1 sprint board (Mar 30–Apr 3 2026) | ai-agent service |
| `Server/README.md` | Backend overview — **stale** (no R2, BullMQ, queues, storage abstraction) | Don't trust |
| `Server/docs/cdn-urls.md` | JSON CDN frontend integration | Reading game/category data on the client |
| `Server/docs/json-cdn-implementation.md` | JSON CDN architecture, generation pipeline | Touching the JSON CDN system |
| `ai-agent/README.md` | FastAPI + LangGraph service overview | Touching ai-agent |
| `ai-agent/docs/functional-specification.md` | What the agent is supposed to do | Reviewing agent behaviour |
| `ai-agent/docs/progress-tracker.md` | Where the agent build stands | Status check |

There is **no** documentation for: the storage abstraction, the multi-layer cache architecture, the auth flow, the WebSocket subsystem, the cron registry, or the file-upload end-to-end pipeline. Those are in §6.

There is also a `tmp_report/` directory in the repo root that should probably be deleted; see §14.

---

## 6. Subsystem catalog

This is the gap-filler. Each subsection points at the canonical files, names the load-bearing invariants, and flags the gotchas.

### 6.1 Analytics — covered elsewhere

`docs/internal_dashboard_analytics.md` is comprehensive (444 lines). The summary you need to keep in your head:

- Three pipelines: **internal** (always-on, admin-excluded, first-party, source of truth for product) → `docs/ga4_vs_dashboard.md` is the explainer for non-engineers; **GA4 via Cloudflare Zaraz** (production-only, consent-gated) → owned by client (see §12); **Meta Pixel** (production-only, consent-gated, direct, not via Zaraz).
- The admin-exclusion invariant is enforced at three layers: controller, worker, query. Roles excluded: `superadmin`, `admin`, `editor`, `viewer`. `player` and anonymous are tracked. **Fail-open** when role is unknown — `Server/src/services/adminExclusion.service.ts:38-46` is intentional, do not change.
- `ALLOWED_ACTIVITY_TYPES` (`Server/src/controllers/analyticsController.ts:17-23`) is a 5-item allow-list. Adding a new value requires updating the dashboard query that consumes it; they aren't coupled.
- 30-second floor + soft-delete (`isDiscarded`): rows under 30s aren't deleted, just flagged. Every dashboard aggregation already filters `duration >= 30`, so they're implicitly excluded; Total Visitors explicitly excludes `isDiscarded = true`.
- Anonymous `sessionId` is per-tab and **wiped on login** (`Client/src/utils/sessionUtils.ts`, `Client/src/layout/RootLayout.tsx:21-25`). This prevents admin contamination of post-login analytics.
- A pre-existing analytics audit exists at `docs/analytics_audit.md` (2026-04-17). I just completed a response to a separate **client-commissioned audit** at `~/Downloads/_Analytics Stack Audit.md`; my pushback document is at `~/Downloads/Analytics_Audit_Pushback.md`. Both are worth reading for context.

**Recent analytics fixes you need to know about:**
- Dashboard period boundaries now respect user timezone correctly. Previously the dashboard used `setHours(0,0,0,0)` which silently ran in server-local time; the fix lives at `Server/src/utils/timezonePeriod.ts` (commits `2ba50f4b`, `e63650b1`). Don't bypass these helpers.
- `last24hours` is a true rolling 24h window — `fix/rolling-24h-window` branch, PRs #437 and #441.
- Custom date filter cache key collision fixed (`076cd84c`).
- "Today" preset added (`feat/today-filter`, PR #443) — this is calendar-day-Today in the user's timezone, **not** rolling 24h.
- Yesterday preset added (`4b74b3c1`).
- Cookie consent banner is now wired to gate Meta Pixel + Zaraz (`fix/consent-banner-wiring`, PR #434, commit `9f1ee31b`).

### 6.2 Storage — three providers, one interface

Provider-agnostic. The interface is at `Server/src/services/storage.interface.ts`:

```ts
interface IStorageService {
  uploadFile(buffer, name, contentType, folder?): Promise<UploadResult>;
  generatePresignedUrl(key, contentType): Promise<string>;
  downloadFile(key): Promise<Buffer>;
  uploadDirectory(localPath, remotePath): Promise<void>;
  deleteFile(key): Promise<boolean>;
  moveFile(sourceKey, destinationKey): Promise<string>;
  getPublicUrl(key): string;
}
```

Three implementations: `local.storage.adapter.ts` (dev), `s3.storage.adapter.ts` (AWS), `r2.storage.adapter.ts` (Cloudflare R2). Selected at boot via `STORAGE_PROVIDER` env var (in production: pulled from AWS Secrets Manager — see `task-def.json:111`). Production currently runs **R2** by inspection of `task-def.json` (the `R2_*` env vars are present and non-empty). The S3 references in `task-def.json` are the same bucket name (`chareli-games-cdn-production-v1`) because the original deploy used S3 and the env var was kept compatible.

Key files for changes:
- Provider switching logic: `Server/src/services/storage.service.ts`
- File controller: `Server/src/controllers/fileController.ts`
- Game controller (which orchestrates uploads): `Server/src/controllers/gameController.ts`

CloudFront sits in front of public game asset delivery and uses **signed cookies** (not signed URLs) to gate access. Cookies are set on game-list and game-detail responses (`gameController.ts`). Lifetime is 1 day. The signing key pair is in AWS Secrets Manager (`CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` — note the latter is a multi-line PEM stored as a single-line `\n`-escaped string).

**Don't hard-code S3 SDK calls in new code.** Go through the storage service. The audit history of this codebase has examples of S3-specific calls leaking into controllers and breaking R2 deploys.

### 6.3 JSON CDN — pre-rendered game/category JSON

Documented in detail in `Server/docs/json-cdn-implementation.md` and `Server/docs/cdn-urls.md`. Summary:

- Cron job (`Server/src/jobs/jsonCdnRefresh.job.ts`) regenerates four JSON files every 5 minutes: `categories.json`, `games_active.json`, `games_all.json`, `games/{slug}.json`.
- Files uploaded to R2 under `cdn/` prefix, served via Cloudflare CDN at `https://dev.cdn.arcadesbox.org/cdn/` (dev), `https://staging.cdn.arcadesbox.org/cdn/` (staging), `https://cdn.arcadesbox.org/cdn/` (prod).
- Cache headers: `Cache-Control: public, max-age=300` (5 min). Worst-case staleness ≈ 7 min (5 min cron + 5 min cache, overlapping).
- Frontend pattern: try CDN first with 3-second timeout, fall back to API. Examples in `Server/docs/cdn-urls.md:140-189`.
- Toggle: `JSON_CDN_ENABLED` (server) and `VITE_CDN_ENABLED` (client).

**This is one of the five cache layers in the system. The full set is:**
1. JSON CDN at the edge (5 min)
2. CloudFront for game asset delivery (signed cookies, 1 day)
3. Redis dashboard cache (3 min TTL + write-time invalidation, 13 invalidation call sites — see `AGENTS.md` §7)
4. TypeORM query cache (set per-query where used)
5. React Query / TanStack Query cache (client side, per-key TTL)

When making schema or data changes that affect dashboard or game listings, **walk all five layers**. This is on my saved list of repo-specific gotchas — if a number doesn't update, the missing layer is usually one of these.

### 6.4 Auth — JWT + 5-role hierarchy

Five roles, intentional hierarchy: `player` → `viewer` → `editor` → `admin` → `superadmin`. JWT access token + refresh token. Files:

- Service: `Server/src/services/auth.service.ts`
- Controller: `Server/src/controllers/authController.ts`
- Middleware: `Server/src/middlewares/authMiddleware.ts` — exposes `authenticate` (required) and `optionalAuthenticate` (sets `req.user` if token valid, no error if absent).
- Role entity / seed: `Server/src/entities/Role.ts`. Roles are seeded by migration `1752685815517-addViewerToRoles.ts`.

Endpoints that use `optionalAuthenticate` notably include the analytics homepage-visit beacon and the `sendBeacon`-based game-end path (which can't carry an Authorization header). Don't switch them to `authenticate`.

OTP flow uses Twilio and writes to the `Otp` entity. SMS is the canonical channel; email OTP is implemented as a fallback. First-login OTP sets `hasCompletedFirstLogin = true` on the User row — many dashboard queries gate on this.

Refresh tokens are intentionally not recorded in analytics (silent infra event, not user action). Documented at `docs/internal_dashboard_analytics.md:124`.

### 6.5 Caching architecture

Three layers on the server, two more outside it. See §6.3 for the full list. Server-side details:

- **Redis service** (`Server/src/services/redis.service.ts`) — bare ioredis client, used by BullMQ, by the cache service, and by rate limiting.
- **Cache service** (`Server/src/services/cache.service.ts`) — typed wrappers around Redis: `getAnalytics`, `setAnalytics`, `invalidateDashboard`, `getGames`, `setGames`, etc. **Always go through this service**, never call Redis directly.
- **Cache invalidation service** (`Server/src/services/cache-invalidation.service.ts`) — wraps the above to provide consistent invalidation semantics (e.g. invalidate all variants of a game's cached representation).
- **Cloudflare cache service** (`Server/src/services/cloudflare-cache.service.ts`) — purges the Cloudflare CDN edge cache for specific URLs when content changes (e.g. when a game is edited, its detail-page edge cache needs to be busted).

**Invariant: any write that affects a dashboard number must call `cacheService.invalidateDashboard()`.** There are 13 call sites today. Adding a new write path means adding a 14th. `AGENTS.md` §7 explains why we invalidate AND have a 3-min TTL backstop (defence in depth — a forgotten invalidation call results in <3 min staleness rather than indefinitely stale data).

### 6.6 Queues and workers — BullMQ + Cloudflare Worker

**Two distinct worker systems:**

**A. BullMQ workers** (in-process, run inside the same Node container as the API):

| Queue | Worker file | Writes to |
| :--- | :--- | :--- |
| `analytics-processing` | `Server/src/workers/analytics.worker.ts` | `internal.analytics` |
| `homepage-visit` | `Server/src/workers/homepageVisit.worker.ts` | `internal.analytics` |
| `click-tracking` | `Server/src/workers/clickTracking.worker.ts` | `public.game_position_history` |
| `like-processing` | `Server/src/workers/like.worker.ts` | `public.game_likes` + `public.game_like_cache` |
| `image-processing` | `Server/src/workers/imageProcessor.ts` | thumbnail variants in storage |
| `thumbnail` | `Server/src/workers/thumbnailProcessor.ts` | (older — thumbnail moves) |
| `game-zip-processing` | `Server/src/workers/gameZipProcessor.ts` | extracts ZIP to storage; **fallback path** |
| `json-cdn` | `Server/src/workers/jsonCdn.worker.ts` | the four JSON CDN files |

There are also `*Processor.ts` files (`analyticsProcessor.ts`, `clickTrackingProcessor.ts`, `homepageVisitProcessor.ts`, `imageProcessor.ts`, `jsonCdnProcessor.ts`, `likeProcessor.ts`, `thumbnailProcessor.ts`) alongside the `*.worker.ts` files. These are older and partially superseded — the `.worker.ts` files are the active ones. **There is real duplication here.** A future cleanup should pick one naming and delete the other. I'd lean to keeping `.worker.ts` and deleting the `Processor` siblings, but verify each is dead before removing.

Worker concurrency, retries, and backoff are configured in `Server/src/services/queue.service.ts`. Default: concurrency 5, retries 3 with exponential backoff. The image and ZIP workers historically ran at concurrency 1 (see `docs/upload_optimization_analysis.md` §4). Bumping these is one of the cheap wins still available.

**B. Cloudflare Worker** for game ZIP processing — the primary production path. Lives at `Server/workers/game-zip-processor/` (note: outside `src/`). Has its own `package.json`, dependencies, `wrangler.toml`-equivalent config, deployed via the `deploy-worker` job in `.github/workflows/{dev,staging,release}.yml`. Calls back into the main API with `X-Webhook-Secret`, `X-Idempotency-Key`, and `X-Attempt` headers (CORS allow-list at `Server/src/app.ts` line ~70 references these). Webhook endpoint: `Server/src/controllers/webhookController.ts`.

When a game ZIP arrives:
1. Frontend uploads the ZIP directly to R2 via presigned URL (Uppy AWS-S3 plugin).
2. Frontend calls `POST /api/games` with the ZIP key.
3. Server enqueues a Cloudflare Worker job AND a BullMQ job (defence in depth).
4. Cloudflare Worker downloads the ZIP, extracts, validates, re-uploads, and webhooks back to `Server/src/controllers/webhookController.ts`.
5. Server marks the game as `processed` and invalidates JSON CDN.

This is also how games get their CDN URLs.

### 6.7 Game upload flow — end to end

Captured at `docs/upload_optimization_analysis.md` (architecture diagram + bottleneck analysis). Read it. The proposed optimisations (S3 CopyObject, parallelize file ops, increase worker concurrency) are mostly **not yet implemented** — they're a backlog item.

### 6.8 Communications — email, SMS, push

- **Email**: `Server/src/services/email.service.ts`. Three providers in `package.json` (`@sendgrid/mail`, `nodemailer`, `resend`). Production uses **AWS SES** via `@aws-sdk/client-ses` (note: `task-def.json` sets `SES_REGION=eu-central-1`, separate from the rest of the app in `us-east-1`). The SendGrid/Resend/Nodemailer are migration baggage.
- **SMS / OTP**: `Server/src/services/otp.service.ts`. Twilio. Verified service via Twilio Verify API (`TWILIO_SERVICE_SID`).
- **Push / WebSocket**: `Server/src/services/websocket.service.ts`. Socket.io with the Redis adapter for cross-instance broadcast. Used for real-time admin notifications (e.g. game proposal updates surfacing in the admin panel without refresh). Client side: `Client/src/hooks/useWebSocket.ts`.
- **AI notifications**: `Server/src/services/aiNotification.service.ts`. Wrapper used by the AI agent integration to notify admins when a proposal needs attention.

### 6.9 Cron jobs

Registry: `Server/src/jobs/index.ts:11-38`.

| Job | Schedule | What it does |
| :--- | :--- | :--- |
| User inactivity check | `0 0 * * *` (midnight daily) | `Server/src/jobs/userInactivityCheck.ts` — flags users who haven't logged in for the configured threshold |
| Like count cache refresh | `0 2 * * *` (2am daily) | `Server/src/cron/updateLikeCounts.ts` — recomputes the materialised like-count cache (`GameLikeCache`) |
| JSON CDN refresh | `*/5 * * * *` (every 5 min) | `Server/src/jobs/jsonCdnRefresh.job.ts` — see §6.3 |
| Image reprocessing | (manual / queue-driven) | `Server/src/jobs/imageProcessor.job.ts` — kicks off batched re-thumbnail jobs |

Adding a cron: register in `initializeScheduledJobs()` in `jobs/index.ts`. Cron schedules run inside the API container. With PM2 clustering in production, **the cron will fire on every PM2 worker** unless guarded by a Redis-backed lock — none of the current crons are. For low-frequency idempotent jobs (the `0 0 * * *` patterns above) this is fine; the JSON CDN refresh deduplicates via BullMQ job IDs. Don't add a frequent cron without thinking about the dedup.

### 6.10 Rate limiting

`Server/src/middlewares/rateLimitMiddleware.ts:171-205` defines the `analyticsLimiter`: 500 events/minute per key, key precedence `userId > sessionId > req.params.id > IP`. Redis-backed via `rate-limit-redis`. **Falls open if Redis is down** (documented graceful degradation — analytics writes stay live during a Redis outage). Skipped in `NODE_ENV=development|test`.

Other limiters in the same file: `authLimiter`, `adminLimiter` (300/min), `passwordResetLimiter`, `signupLimiter`. The `circuit-breaker`-style protection is `opossum` (in `package.json`) but is currently only wired for outbound calls to a couple of services — see `Server/src/services/aiNotification.service.ts`.

### 6.11 Crawler protection

`Server/src/middlewares/crawlProtection.ts`. Custom user-agent/header-based filtering layered before Helmet. Blocks known scraping signatures. Be aware when testing with custom user agents.

`/robots.txt` at `Server/src/app.ts:~108` returns `User-agent: *\nDisallow: /` — **everything blocked**. This is intentional for now; SEO is handled by hostname-targeted rules at the Cloudflare layer, not in `robots.txt`.

---

## 7. Deployment and infrastructure

### 7.1 AWS resources (Server)

- **Compute**: ECS Fargate, 1024 CPU / 2048 MB. Task family `chareli-task-production-v1`. Region `us-east-1`. See `task-def.json` (the source of truth for the task definition).
- **Image registry**: ECR `330858616968.dkr.ecr.us-east-1.amazonaws.com/chareli-server-production-v1`.
- **Database**: RDS Postgres (DB_HOST is in Secrets Manager — not visible in the task def by design).
- **Cache / queue**: ElastiCache Redis at `chareli-production-v1.ayv7lb.ng.0001.use1.cache.amazonaws.com:6379`.
- **Object storage**: R2 primarily (also S3 — same bucket name `chareli-games-cdn-production-v1`).
- **CDN**: CloudFront for game asset delivery (signed cookies). Cloudflare in front of the JSON CDN.
- **Secrets**: AWS Secrets Manager, ARN `arn:aws:secretsmanager:us-east-1:330858616968:secret:chareli/production/v1/application-secrets-PNu7WL`. Includes DB creds, JWT secrets, R2/S3 credentials, Twilio, Cloudflare account ID, superadmin seed, etc.
- **Email**: SES in `eu-central-1` (separate region from the rest).
- **Logs**: CloudWatch group `/ecs/chareli-production-v1`, stream prefix `ecs`.

### 7.2 Cloudflare resources

- **Pages**: Frontend SPA hosting. Project name pulled from `vars.PAGES_PROJECT_NAME` in workflows.
- **Workers**: `Server/workers/game-zip-processor` deployed as a Cloudflare Worker.
- **Zaraz**: GA4 + Google Ads tag manager. **Configuration lives in the Cloudflare dashboard, not the repo.** See `docs/zaraz_setup_runbook.md`.
- **R2**: Object storage (alternative to S3).
- **CDN / cache rules**: `cdn.arcadesbox.org` mapping, cache rules, etc.

**Cloudflare configuration is not in version control.** The Zaraz dashboard, Pages settings, R2 bucket policies, CDN cache rules, etc. are all in the Cloudflare console. There is no `wrangler.toml` for Pages or Zaraz. For the game-zip Worker, there is wrangler-style config inside `Server/workers/game-zip-processor/`.

### 7.3 Region / latency caveats

- Server in `us-east-1`, Email in `eu-central-1`, R2 is region-agnostic (Cloudflare). Most infrastructure is in `us-east-1`. **Don't introduce a new AWS service without checking the region** — cross-region calls from ECS Fargate to a different AWS region cost both latency and money.
- The product's primary audience is West Africa / Europe. Cloudflare's edge network is the load-bearing latency mechanism — assets and JSON CDN are served from the user's nearest PoP. The API itself is single-region; if latency-to-API becomes a concern, the JSON CDN is the layer to push more data into rather than multi-region the API.

---

## 8. CI/CD

Three workflows in `.github/workflows/`:

- `dev.yml` — fires on push to `dev` → development environment.
- `staging.yml` — fires on push to `main` → staging environment.
- `release.yml` — fires on push to `release` → production.

Branch model: feature branches → PR to `main` (which auto-deploys staging) → after QA, merge `main` → `release` for production. Hotfixes go directly to `release` via PR.

Each workflow has the same structure (with environment-specific secrets):

1. **detect-changes**: `dorny/paths-filter@v3` to skip backend/frontend if untouched.
2. **build-and-test-backend**: `npm ci` + `npm run lint` (continue-on-error) + `npm test` (continue-on-error) on Node 22.
3. **build-and-test-frontend**: same, plus `npm run build` and an artifact upload.
4. **deploy-backend**: build Docker image, push to ECR, render the task definition, deploy to ECS, **then run `npm run warm-cache` via `aws ecs execute-command`** on the live container to warm Redis post-deploy.
5. **deploy-frontend**: download artifact, `cloudflare/wrangler-action@v3 pages deploy`, then a Cloudflare cache purge.
6. **deploy-worker**: build the game-zip Worker via `wrangler deploy --dry-run --outdir dist`, then upload via the Cloudflare API.
7. **deploy-ai-agent** (only in `staging.yml` and `release.yml`): build and push the ai-agent Docker image. **Not in `dev.yml`.**

**Test failures don't block deploys** (`continue-on-error: true` on lint and test steps). This is technical debt — tests need to be made reliable enough to gate deploys, then this flag should be removed. Don't propose removing it before fixing the flakiness.

The cache-warm step uses ECS Exec (`aws ecs execute-command`). For this to work the task role needs the `ssmmessages:*` permissions and the service needs `enableExecuteCommand: true`. Verify these if cache warming starts silently failing.

---

## 9. Testing

`TESTING_SETUP.md` is the philosophy doc. Treat it as directional — last update 2025-09 and the suite has grown since.

### 9.1 Server tests

- Jest + Supertest. Single-threaded (`--runInBand`) because the suite shares mocked DB state.
- Tests live under `Server/src/**/__tests__/` matching `*.test.ts` / `*.spec.ts` (`testMatch` in `jest.config.js`).
- DB and Redis are mocked. Real-DB-dependent paths return 500 in unit tests unless explicitly mocked. This is intentional — there is no integration test suite running against a real Postgres.
- `Server/src/services/__tests__/` contains shared mocks. Files in there must not match the `testMatch` suffix or Jest will load them as empty test files. Rename to `.mocks.ts` if you add one.
- `npx jest path/to/file.test.ts` runs a single file. `npx jest -t "name substring"` runs by test name.

**Gotchas:**
- File upload tests (`fileController.test.ts`) **must mock `services/storage.service`** locally, otherwise they hit real R2. `Server/src/controllers/__tests__/fileController.test.ts` has the pattern.
- Integration-style controller tests against analytics will write rows. Some don't clean up. Check before running.
- `jest --detectOpenHandles --forceExit` (the `test:ci` script) is the version CI runs — surfaces leaks. Locally, prefer `npm test` to keep iteration fast.

### 9.2 Client tests

- Vitest. Node environment (no DOM by default). The convention is to test business logic, not rendering.
- Tests in `Client/src/**/__tests__/`.
- `npm run test:run` is the one-shot mode; `npm test` runs in watch mode.
- Tests cover: validation (`Client/src/validation/__tests__/password.test.ts`), auth context logic, route protection, service hooks, and a handful of utility functions. There are intentionally **no component-rendering tests** — they were judged low value in `TESTING_SETUP.md`.

### 9.3 Smoke / manual scripts

`Server/scripts/`:
- `verify-admin-exclusion.sh` — runs the SQL from `AGENTS.md` against the configured DB, expects 0 rows.
- `verify-frontend-code.sh` — sanity grep probes for the frontend invariants.
- `test-with-devtools.sh` — runs Server with `--inspect` for debugging.
- `view-analytics.sql`, `clear-analytics.sql` — direct SQL utility queries (use against staging or local).

Run `./Server/scripts/verify-admin-exclusion.sh` against staging at least once a sprint as a regression check.

---

## 10. Work in flight as of 2026-05-07

These are the items that are mid-stream — **read these before committing to a direction**.

### 10.1 AI review agent rollout

- The v1 sprint completed 2026-04-03. Code is on `ai-main` and merged to `main` via PR #442 (`64abf4f`, 2026-05-06).
- A follow-up **Visual SEO Agent** branch (`origin/feature/add-visual-seo-agent`, harrietfiagbor) is active, last commit 2026-04-28. Has not merged. Status unknown to me — ask Harriet.
- Latest standalone ai-agent commits (on `ai-main` / merged): "pipeline improvements and architectural cleanup" (`214c5f08`), "AIExecutor with structured output repair" (`5260570`), "JSON sanitization utility" (`b7a75ea1`).
- **Untracked file in repo**: `Server/scripts/create-ai-agent-user.ts`. This is one of the AI-agent integration scripts (creates the service-account user that the ai-agent authenticates as). It needs to be committed before anyone else needs to run it. I didn't commit it because I wasn't sure if it had embedded creds — open it and check before pushing.
- The `feat/ai-agent-deploy` PR (#445, `1d7a14f`) added the docker deploy job to staging and release workflows. Confirm both workflows are green on the next deploy.

### 10.2 Categories — slug-based landing pages

Recently shipped in three PRs:
- PR #446: `feat/category-slug-landing` — public slug-based pages with intro + FAQ
- PR #448: `feat/category-slug-landing` (continuation) — sidebar nav to `/categories/<slug>`
- PR #449: `fix/category-landing-thumbnail-url` — thumbnail bug
- PR #451: `feat/category-detail-page-and-sidebar` — admin edit button, edit-as-page experience

Migration `1777500000000-AddSlugIntroFaqToCategory.ts` added the data fields. There may be linkage from the AI agent (which generates the FAQ/intro content) — verify before changing these fields.

### 10.3 Dashboard date filters

Three recent fixes/features:
- PR #437: `last24hours` is now a true rolling window (was calendar day before).
- PR #441: rebuild custom date filter, fix cache key collision.
- PR #443: replace 24h preset with calendar-day Today filter.
- PR #443 (associated): added Yesterday preset.

The two date concepts now coexist on the dashboard — "Today" (calendar-day in user TZ) vs "last 24h" (rolling). They're computed by different code paths in `Server/src/utils/timezonePeriod.ts`. Verify both render correctly across DST transitions.

### 10.4 Gameplay URL canonicalization

PR #447 (`3f5f6475`): URLs now canonicalize to `/gameplay/<categorySlug>/<gameSlug>`. The redirect logic is at `Client/src/pages/GamePlay/GamePlay.tsx:42-48`. Watch out — if a category is renamed, every old slug-based URL still works (the API can resolve by either UUID or slug) but the URL gets rewritten via `navigate(canonical, { replace: true })`. Search-engine-friendly.

### 10.5 Analytics audit response (just finished)

The client requested an external audit of the analytics stack. The audit is at `~/Downloads/_Analytics Stack Audit.md` (not in repo). My pushback document is at `~/Downloads/Analytics_Audit_Pushback.md` (also not in repo). The audit is largely accurate; pushback covers (1) Zaraz dashboard items being out of our scope, (2) intentional design being framed as defects, (3) operational cost of the recommended throttle change. Three audit recommendations were accepted: remove the `'admin-excluded'` placeholder ID, fix `Bearer null` heartbeat header, surface consent acceptance rate. **None of these are implemented.** If the new engineer takes over the audit response, those three items are the actionable list.

### 10.6 Recent dependency cleanup

PR-less commit `57a129e` (HEAD): removed Drizzle dependencies (the project briefly considered Drizzle alongside TypeORM but stayed with TypeORM). **`Server/drizzle.config.ts` still exists** — it should be deleted in a follow-up. Also `Server/data.sql`, `Server/data_new.sql`, `Server/migrations.sql`, `Server/supabase_schema.sql` look like orphaned schema dumps that should be cleaned up.

### 10.7 Branch graveyard

There are 70+ branches in the remote, including ten with `backup-` prefixes (`backup-fix`, `backup-fix2`, `backup-fix3`, `backup-fix5`, `backup-before-cleanup-20251227`). These are real branches someone created for safety during high-stakes refactors and never deleted. Worth a quarterly cleanup pass — `git for-each-ref --sort=committerdate refs/remotes/origin/` and prune anything stale older than 6 months that's been merged.

---

## 11. Known gotchas the codebase will not warn you about

This is the tribal knowledge section. Each item has bitten me or someone else.

1. **Staging login uses `identifier`, not `email`.** Production accepts `email`; staging accepts `identifier` (which can be email or phone). When scripting against staging, don't blindly copy the curl from prod.
2. **`SES_REGION=eu-central-1` while everything else is `us-east-1`.** Don't try to consolidate without checking deliverability — SES warm-up matters and this region is configured correctly for the customer audience.
3. **Storage provider switches behaviour silently.** `STORAGE_PROVIDER=s3` and `=r2` produce different public URLs. The DB stores keys, not URLs (this is on purpose — see `Server/README.md` §"File Storage Architecture"). Test both providers before merging anything that touches `storage.service.ts`.
4. **Five cache layers all matter.** A change that should affect dashboard numbers needs to walk JSON CDN → Redis dashboard cache → invalidation calls → React Query keys → CloudFront if you changed any URL. See §6.3.
5. **The `'admin-excluded'` sentinel string is real and the client doesn't special-case it.** When an admin user plays a game, the worker returns `{ id: 'admin-excluded' }`, the client stores it as the analytics row ID, and every subsequent PUT/heartbeat to `/api/analytics/admin-excluded` 404s (or possibly 500s if Postgres rejects the invalid UUID). This is documented in the audit response — it's noisy but not data-corrupting. Fix is queued.
6. **`sessionId` is per-tab and wiped on login** — see `AGENTS.md` §5. Two tabs of the same anonymous user = two distinct visitors in the dashboard. Don't change this without thinking about admin contamination.
7. **`zaraz` is undefined outside production.** `isAnalyticsEnabled()` will return false in dev/staging, so any `trackEvent` call is a silent no-op. Use the Zaraz Monitoring view in the Cloudflare dashboard against production to verify events; **GA4 DebugView does not work reliably with Zaraz** (see `docs/zaraz_setup_runbook.md` §7 — this is a documented Cloudflare limitation, not our bug).
8. **Cookie consent is the load-bearing gate for marketing trackers.** `Client/src/utils/consent.ts:62-64` explains: dashboard-side consent purposes in Zaraz are the client's responsibility; until they're configured, our `hasMarketingConsent()` check in `isAnalyticsEnabled()` is doing all the work.
9. **`fbq` initializes 2 seconds after `window.load`.** Don't write code that assumes the Pixel is ready synchronously. `Client/src/analytics.ts:23-69`.
10. **The 24-hour past-timestamp guard on analytics writes is intentional.** A long-open browser tab whose `startTime` is more than 24h old will get a 400 with no client retry. This is bounded by spec — a real game session never has a startTime that old. Don't relax `MAX_PAST_TIMESTAMP_MS`.
11. **Game ZIP processing has two implementations.** Cloudflare Worker (production) + BullMQ worker (`Server/src/workers/gameZipProcessor.ts`). Don't make changes to one without checking the other. Long-term: deprecate the BullMQ one.
12. **Two BullMQ libraries are in `package.json`** (`bull` and `bullmq`). `bullmq` is current; `bull` may be in legacy code paths. Don't add new code using `bull`.
13. **Three email providers** (`@sendgrid/mail`, `nodemailer`, `resend`) plus AWS SES — production uses SES. Don't add a fourth without ripping the unused ones out.
14. **Three form libraries** (`react-hook-form`, `formik`, `yup`, plus `zod`). New work uses `react-hook-form` + `zod`. Don't add a fifth.
15. **`dist/` is committed in `Server/`.** This is wrong — it should be in `.gitignore`. Removing it is a real change that needs CI verification (the production start script is `npm run warm-cache && node dist/index.js`, but that runs after `npm run build` writes to `dist/`, so it should be fine). Logged here so the next engineer doesn't push more `dist/` content by accident.
16. **`.history/` is committed.** This is the VS Code Local History extension's auto-save folder. Should be gitignored.
17. **`Arcadesbox Scale Architecture - Technical Suggestions.pdf` lives at the repo root.** It's a 137 KB design doc from March 2025. Move it into `docs/` and rename it.
18. **`tmp_report/` directory exists at the repo root.** It's a transient output. Should be deleted or gitignored.
19. **Sonar scanner is wired** (`sonar-project.properties`) but I never confirmed it's running or where the dashboard is. If the next engineer needs SonarQube results, dig into the GH Actions logs on a recent merge to see if the scan step appears.
20. **CORS error in Pages preview deployments**: the `*.pages.dev` regex in `app.ts` covers Cloudflare Pages preview URLs. If a preview deploy gets a different domain, CORS will block. Verify in the deploy logs.

---

## 12. External dependencies and ownership boundaries

**This is the most important non-technical handoff item.** Several systems that look like ours from the outside are actually owned by the client / a different team:

| System | Owner | What we own |
| :--- | :--- | :--- |
| Cloudflare Zaraz dashboard | Client | The `trackEvent` calls and `isAnalyticsEnabled()` gate in our code |
| GTM | Client | n/a — we don't use GTM directly anymore (commented out in `index.html`) |
| GA4 property + custom dimensions / Key Events | Client | The events we emit (10 of them, see `docs/zaraz_setup_runbook.md` §1) |
| Google Ads conversion configuration | Client | n/a — actions configured in Cloudflare Zaraz dashboard |
| Meta Business Manager / Pixel admin | Client | The `fbq` calls in `Client/src/utils/analytics.ts` and `Client/src/analytics.ts` |
| Cookie consent banner UX (visual) | Client | The `getConsentState()` logic in `Client/src/utils/consent.ts` |
| Domain (`arcadesbox.com`) and DNS | Client / IP-Quantum | n/a |
| Cloudflare account | Client / IP-Quantum | We deploy via GH Actions using their API token |
| AWS account | IP-Quantum | We deploy via GH Actions using OIDC role assumption |
| Customer-facing privacy/legal copy | Client | n/a |

The implication for incoming engineers: when an issue is reported as "GA4 isn't tracking signups" or "the Pixel isn't firing for ad audiences," your first response should be to check whether the issue is **in our code** (an event that should be emitted, isn't) or **in their config** (an event we're emitting that they haven't wired up downstream). Use `Zaraz Monitoring` in the Cloudflare dashboard as the source of truth for "did the event leave our app?" — if yes, the rest is their plumbing.

---

## 13. First-week onboarding plan

A specific path from "cloned repo" to "shipping changes confidently."

### Day 1 — Read

- Read this file (`HANDOFF.md`).
- Read `CLAUDE.md`, `AGENTS.md`, `docs/internal_dashboard_analytics.md` in that order.
- Skim `Server/src/services/adminExclusion.service.ts` (54 lines) and `Server/src/entities/Analytics.ts` (148 lines) so you have the canonical analytics shape in your head.

### Day 2 — Run

- Get the Server running locally with a fresh DB. Run all 44 migrations. Confirm Swagger renders at `localhost:5000/api-docs`.
- Get the Client running. Sign up as a new player. Play a game (any) for >30 seconds. Verify the analytics row exists in `internal.analytics` with `isDiscarded=false`.
- Sign in as the seeded superadmin (creds in your secrets manager / `.env`). Confirm the admin dashboard renders. Confirm your test game-session is **not** in the dashboard count (because superadmin is excluded).
- Sign out, sign in as a player again, verify your session **is** counted.

### Day 3 — Verify the invariants

- Run `./Server/scripts/verify-admin-exclusion.sh` against your local DB. Should be 0.
- Run the `AGENTS.md` sanity grep probes:
  ```bash
  grep -c "NOT IN (:...excludedRoles)" Server/src/controllers/adminDashboardController.ts   # expect 28
  grep -c "duration >= :minDuration" Server/src/controllers/adminDashboardController.ts     # expect 29
  grep -rn "invalidateDashboard(" Server/src/ | grep -v test | grep -v "async invalidate"   # expect 13 across 6 files
  grep -rn "superadmin.*admin.*editor.*viewer" Server/src/workers/                          # expect 0
  ```
- If any drift, that's the first signal something broke. Investigate before doing anything else.

### Day 4 — Make a deliberately small change

- Pick a tiny visible thing — a copy change, a button label, a typo. Open a PR. Watch it through CI to staging.
- Confirm the deploy worked end-to-end: GH Action green, ECS task healthy in CloudWatch, frontend live on staging URL.

### Day 5 — Triage the backlog

- Open `docs/AI_Game_Review_Agent_Task_Board.md` to see the v1 sprint output.
- Look at recently-closed PRs (#437–#451) to see what kinds of changes are in flight.
- Pick up one of the small items from §10.6 (delete `Server/drizzle.config.ts`, `data.sql`, `data_new.sql`) — the cleanup is in-scope, low-risk, and a good way to walk through the build/test/deploy loop yourself.

After the first week, the harder work is up to you and the team. The analytics surface is the deepest part of the system; the AI agent integration is the newest; the storage / CDN layering is the most likely to surprise.

---

## 14. Repo housekeeping — stale files and orphaned branches

### 14.1 Files to delete or relocate

- `Server/drizzle.config.ts` — Drizzle was removed in `57a129e`; this file should follow.
- `Server/data.sql`, `Server/data_new.sql` — schema/data dumps, predate the migration history. Verify and delete.
- `Server/migrations.sql` — same. The TypeORM migrations are the source of truth.
- `Server/supabase_schema.sql` — Supabase isn't part of this stack. Likely a vestige from an earlier prototype.
- `Server/server.log`, `Server/server_direct.log`, `Server/server_retry.log` — logs that got committed. Should be gitignored.
- `Server/results.txt` — unclear; likely stale test output.
- `Server/dist/` — build output committed. Gitignore.
- `.history/` — VS Code Local History extension. Gitignore.
- `tmp_report/` (repo root) — transient. Delete.
- `Arcadesbox Scale Architecture - Technical Suggestions.pdf` — move to `docs/`.
- `Server/get-game.js`, `Server/get-game.sh` — utility scripts that aren't documented. Verify whether they're still used; either document or delete.
- `repomix.config.json` (3 copies — root, `Server/`, `Client/`). Tooling artefact. Probably fine to leave.

### 14.2 Untracked file to commit or remove

- `Server/scripts/create-ai-agent-user.ts` — see §10.1.

### 14.3 Branches to consider pruning (sample, not exhaustive)

`backup-fix`, `backup-fix2`, `backup-fix3`, `backup-fix5`, `backup-before-cleanup-20251227`, `backup-fix-II`, plus older feature branches (`SEO`, `about-fix`, `additional-filters`, `additional-filters-update`, `albert/image`, `chris-build`, `change-about`, `clicks-description`, etc.). The full list is `git for-each-ref refs/remotes/origin/`.

A safe pruning pass: any branch where the merge-base with `release` is more than 90 days old AND the branch has been merged to `release`/`main` is safe to delete remotely. Don't delete unmerged branches without asking the author.

---

## 15. Open questions

These are things I would have liked to confirm before leaving but didn't. Logging them so the next engineer doesn't waste time discovering them.

1. **Sonar dashboard URL.** `sonar-project.properties` is wired but I don't have the dashboard link. Check the GH Actions workflow logs on a recent merge — the Sonar step (if any) should print it.
2. **Where does the ai-agent's MongoDB live?** `MONGODB_URL` is referenced in `ai-agent/.env.example` but I don't know which Mongo instance it points to in production. Ask the AI agent team (Victoria / Harriet / Bekoe).
3. **Whether the BullMQ-based `gameZipProcessor` is dead code or active fallback.** Test by stopping the Cloudflare Worker (in a non-prod env) and watching whether the BullMQ worker picks up the slack. If it does, document the failover; if not, delete.
4. **Whether all the `*Processor.ts` worker files are dead code** (paired with `*.worker.ts` files). I believe yes, but verify by removing one and watching for breakage in staging.
5. **JSON CDN cache invalidation on game edits.** The cron regenerates every 5 min but a manual invalidation should fire when a game is published/edited. Confirm `cacheService` calls into `jsonCdnService.invalidateCache(...)` from the right places.
6. **Whether `npm run warm-cache` in the post-deploy step covers all dashboard variants.** I haven't traced what `warm-cache` actually warms. If it only warms the no-filter dashboard, every other filter is cold for the first user.
7. **The exact auth token format for the AI agent.** `Server/scripts/generate-service-token.ts` produces a non-expiry JWT; verify the rotation procedure when the token is compromised. There's no automated rotation today.
8. **Whether `crawlProtection` is too aggressive.** It blocks based on user-agent patterns — verify legitimate Cloudflare health checks aren't affected.

---

## 16. Access and contacts

The departing engineer (me) is **Christian Koranteng** (`korantengchristian@gmail.com`, GitHub: `kkfergie22`). After my last day, the people who can answer questions are:

- **AI agent team** (IP-Quantum): Victoria Nyamadie, Harriet Fiagbor, Bekoe Isaac. They own `ai-agent/` and the AI review pipeline. Their context is in `docs/AI_Game_Review_Agent_Task_Board.md`.
- **Client side** (Zaraz / GA4 / Pixel admin / Cloudflare account / domains): see whoever is the project sponsor on the client.
- **AWS account admin**: whoever holds the IP-Quantum AWS root credentials.
- **Cloudflare account admin**: same.

What you'll need access to on day 1:

- GitHub repo (`IP-Quantum-Ltd/<repo>`) — push access at minimum, ideally maintainer.
- AWS console — at least read-only access to ECS, ECR, CloudWatch, Secrets Manager, RDS in `us-east-1`.
- Cloudflare console — Pages, Workers, R2, Zaraz, CDN.
- Production database read access (for debugging — never write directly).
- Staging database (for testing migrations).
- Slack / comms channel where the team coordinates (I don't know which one — ask).

---

## Final note

This document is a snapshot. The codebase will keep evolving; please **update this file as the source of truth changes** rather than letting it drift. The single best way to keep it current is to do a 30-minute pass on it any time a major architectural change ships — that has roughly the same maintenance cost as keeping a blog and substantially more value for everyone else.

If anything in §11 (the gotchas list) bites you and isn't already documented, add it. That section is the highest-leverage part of this file.

Good luck.

— Christian
