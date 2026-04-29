# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

Monorepo with two independent Node projects at the root:

- `Client/` — React 19 + Vite + TypeScript SPA (Redux Toolkit, React Query, Tailwind 4, Radix UI, Socket.io-client, Vitest).
- `Server/` — Express + TypeScript REST API (TypeORM/PostgreSQL, Redis + BullMQ, Jest + Supertest, Swagger).

Each has its own `package.json`; there is no root workspace manifest. Always `cd` into the relevant project before running commands.

## Commands

### Server (`cd Server`)

```bash
npm run dev                # nodemon + ts-node on src/index.ts (port 5000)
npm run build              # tsc -> dist/ (plus postbuild swagger gen)
npm test                   # jest --runInBand
npm run test:watch
npm run test:coverage
npm run test:ci            # jest --runInBand --forceExit --detectOpenHandles
npx jest path/to/file.test.ts          # single file
npx jest -t "test name substring"      # single test by name
npx tsc --noEmit           # typecheck only
npm run migration:generate -- src/migrations/NAME
npm run migration:run
npm run migration:revert
```

Swagger UI is served at `http://localhost:5000/api-docs` in dev.

### Client (`cd Client`)

```bash
npm run dev                # vite (port 5173)
npm run build              # tsc -b && vite build
npm run build:staging
npm run lint               # eslint .
npm test                   # vitest (watch)
npm run test:run           # vitest run (once)
npm run test:coverage
npx vitest run path/to/file.test.ts    # single file
```

No lint script exists for `Server/`.

## Architecture essentials

### Server layering

Requests flow through: middleware chain (`requestLogger` → `crawlProtection` → `helmet` → CORS → `authenticate`/`optionalAuthenticate` → `rateLimitMiddleware` → `sanitizeInput`) → route → controller → service or queue → TypeORM repository → PostgreSQL. Errors funnel through `errorHandler` via `ApiError`.

Directory roles under `Server/src/`:

- `controllers/` — thin HTTP handlers; do validation and orchestration, not business logic.
- `services/` — reusable logic (auth, cache, S3/R2 storage, email providers, `adminExclusion.service.ts`, etc.).
- `entities/` — TypeORM models. Migrations under `migrations/` are the source of truth for schema changes.
- `workers/` + `queues/` — BullMQ processors (`analyticsProcessor`, `homepageVisitProcessor`, `clickTrackingProcessor`, `likeProcessor`). Async paths are queued, not synchronous.
- `middlewares/`, `routes/`, `config/`, `jobs/` (cron) as named.

### Storage abstraction

Game assets flow through **either** AWS S3 or Cloudflare R2, chosen at runtime via `STORAGE_PROVIDER`. CloudFront signed cookies gate public asset delivery. Treat the storage layer as provider-agnostic — don't hard-code S3 APIs; go through the storage service.

### Analytics subsystem (critical to get right)

Analytics writes happen from multiple entry points (`authController` login/signup, `userController` invitations, `analyticsController` create/update, `signupAnalyticsController`, homepage visit controller, game-session client calls). **Every write path must go through `AdminExclusionService`** (`Server/src/services/adminExclusion.service.ts`) to exclude users in non-tracked roles (`superadmin`, `admin`, `editor`, `viewer`).

Protection is layered in three places — controller, worker, and aggregation query — and all three must remain consistent. If you add a new write path, wire in admin exclusion at the controller level at minimum.

Allowed `activityType` values are enforced by an allow-list in `analyticsController.ts` (`ALLOWED_ACTIVITY_TYPES`). Add new values there AND at the calling site; the set is intentionally small.

The client clears `sessionId` from sessionStorage on login (`RootLayout.tsx`) so anonymous-session analytics don't bleed into a now-authenticated admin context. Don't re-introduce persistent sessionIds.

### Auth and roles

Five-role hierarchy: `player` → `viewer` → `editor` → `admin` → `superadmin`. JWT access + refresh tokens. The default for `AdminExclusionService.shouldTrackUser` is **fail-open** (track when the role is unknown) to avoid analytics data loss — preserve that behavior.

### Deployment

AWS ECS Fargate (`task-def.json`: 1024 CPU / 2048 MB, us-east-1, secrets via AWS Secrets Manager, logs to CloudWatch `/ecs/chareli-production-v1`). Three GitHub Actions workflows: `dev.yml`, `staging.yml`, `release.yml`. Code runs under PM2 clustering in production.

## Testing notes

- Philosophy (from `TESTING_SETUP.md`): business logic over UI rendering; evolve tests with the code. Client tests use Node env (no DOM) and target validation, auth context, route protection, and service logic rather than component rendering.
- Server tests mock DB/Redis; expect real DB-dependent paths to return 500 in unit tests unless explicitly mocked.
- File upload tests must mock `services/storage.service` locally (see `fileController.test.ts`). Without it, uploads hit real R2 and the suite flakes on network latency.
- `jest.config.js` `testMatch` requires `.test.ts`/`.spec.ts` suffix. Shared fixtures in `__tests__/mocks/` should use another suffix (e.g. `.mocks.ts`) so jest doesn't load them as empty suites.

## Conventions worth keeping

- Commit style matches recent history: `type(scope): summary` (e.g. `fix(ui): ...`, `feat: ...`, `chore(analytics): ...`).
- When the schema changes, add a TypeORM migration; never hand-edit existing migrations.
- New queue jobs follow the pattern in `queues/` + `workers/` rather than being invoked synchronously in a controller.

## Coding Agent behavorial guidlines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
