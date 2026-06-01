# Agent SEO — test results report

**Project:** Chareli (Server)  
**Feature:** Agent SEO auto + manual triggers  
**Run date:** 2026-06-01  
**Overall result:** **PASS** (exit code 0)

---

## Summary

| Metric | Value |
|--------|--------|
| Test suites | 2 passed / 2 total |
| Tests | **7 passed** / 7 total |
| Failed | 0 |
| Skipped | 0 |
| Snapshots | 0 |
| Duration | 9.4 s |
| Exit code | 0 |

**Verdict:** All agent SEO unit and integration tests passed on this run.

---

## Environment

| Item | Value |
|------|--------|
| Working directory | `Server/` |
| Node.js | v23.8.0 |
| pnpm | 11.4.0 |
| OS | Darwin |
| Test runner | Jest (`ts-jest`, `testEnvironment: node`) |
| Config | `Server/jest.config.js` |

---

## Command

```bash
cd Server
pnpm exec jest src/controllers/__tests__/agentSeo.test.ts src/services/__tests__/aiAgent.service.test.ts --runInBand --verbose
```

---

## Test files

| File | Tests | Purpose |
|------|-------|---------|
| `Server/src/controllers/__tests__/agentSeo.test.ts` | 6 | Auto schedule, manual handler, HTTP route, editor negative |
| `Server/src/services/__tests__/aiAgent.service.test.ts` | 1 | AI agent HTTP client (`axios.post`) |

---

## Results by test

### `agentSeo.test.ts`

| # | Type | Describe block | Test name | Result | Time |
|---|------|----------------|-----------|--------|------|
| 1 | Unit | scheduleAgentSeoForGame (auto trigger) | calls triggerAgentRun with game_id and submit_review | PASS | 42 ms |
| 2 | Unit | scheduleAgentSeoForGame (auto trigger) | does not throw when triggerAgentRun rejects | PASS | 17 ms |
| 3 | Unit | runAgentSeoOnGame (manual trigger) | returns 202 and emits agent-seo-started on success | PASS | 17 ms |
| 4 | Unit | runAgentSeoOnGame (manual trigger) | forwards errors to next when triggerAgentRun fails | PASS | 18 ms |
| 5 | Integration | POST /games/:id/run-agent-seo | wires route to handler and returns 202 | PASS | 64 ms |
| 6 | Integration (negative) | createGame editor path | does not schedule agent SEO when editor creates a proposal | PASS | 42 ms |

### `aiAgent.service.test.ts`

| # | Type | Describe block | Test name | Result | Time |
|---|------|----------------|-----------|--------|------|
| 7 | Unit | aiAgent.service | posts to agent run endpoint with body and timeout | PASS | 12 ms |

---

## What each test validates

| Test | Behavior under test |
|------|---------------------|
| Auto — success | `scheduleAgentSeoForGame` calls `triggerAgentRun({ game_id, submit_review: true })` |
| Auto — failure | Agent rejection does not throw; fire-and-forget path survives |
| Manual — success | `runAgentSeoOnGame` returns 202, correct JSON body, calls `emitAgentSeoStarted` |
| Manual — failure | Agent error passed to `next()`; no 202; no WebSocket started event |
| Route integration | `POST /games/:id/run-agent-seo` reaches handler and returns 202 |
| Editor negative | Editor `POST /games` returns proposal 200; `scheduleAgentSeoForGame` never called |
| AI service | `triggerAgentRun` POSTs to `{webhookUrl}/agent/run` with 10s timeout |

---

## Raw Jest output

```
PASS src/controllers/__tests__/agentSeo.test.ts (8.139 s)
  Agent SEO
    scheduleAgentSeoForGame (auto trigger)
      ✓ calls triggerAgentRun with game_id and submit_review (42 ms)
      ✓ does not throw when triggerAgentRun rejects (17 ms)
    runAgentSeoOnGame (manual trigger)
      ✓ returns 202 and emits agent-seo-started on success (17 ms)
      ✓ forwards errors to next when triggerAgentRun fails (18 ms)
    POST /games/:id/run-agent-seo (integration)
      ✓ wires route to handler and returns 202 (64 ms)
    createGame editor path (auto trigger negative)
      ✓ does not schedule agent SEO when editor creates a proposal (42 ms)

PASS src/services/__tests__/aiAgent.service.test.ts
  aiAgent.service
    ✓ posts to agent run endpoint with body and timeout (12 ms)

Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        9.402 s, estimated 11 s
Ran all test suites matching /src\/controllers\/__tests__\/agentSeo.test.ts|src\/services\/__tests__\/aiAgent.service.test.ts/i.
```

---

## Mocks (external dependencies)

These are stubbed in `agentSeo.test.ts` so tests do not hit real services:

- `aiAgent.service` — `triggerAgentRun`
- `websocket.service` — `emitAgentSeoStarted`, `emitAgentSeoComplete`
- `fileUtils`, `slugify`, `cache-invalidation`, `queue`, `storage`, `aiNotification`
- `AppDataSource` — query runner + repositories (editor `createGame` path)

`aiAgent.service.test.ts` mocks `axios` and `config.aiAgent.webhookUrl`.

---

## Not covered by this suite

| Area | Note |
|------|------|
| Full admin `createGame` → auto SEO E2E | Covered indirectly via `scheduleAgentSeoForGame` + code review |
| Live AI agent HTTP | Mocked |
| Client UI / `useAgentSeoTrigger` | No Vitest component tests in this run |
| Proposal approval applying `seoMeta` | Separate controller flow |

---

## Reproduce

From repo root:

```bash
cd Server && pnpm exec jest src/controllers/__tests__/agentSeo.test.ts src/services/__tests__/aiAgent.service.test.ts --runInBand --verbose
```

For broader Server regression:

```bash
cd Server && pnpm test
```

---

## Related docs

- Feature overview: [agent_seo_feature_and_tests.md](./agent_seo_feature_and_tests.md)
