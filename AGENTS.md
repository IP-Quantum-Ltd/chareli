# AGENTS.md — guidance for LLM-assisted reviewers

This file orients an LLM coding assistant (Claude Code, Cursor, Aider, etc.) asked to review recent work in this repo. For the shared working-developer context, see [CLAUDE.md](./CLAUDE.md). This file is purely additive — read both.

## Current review scope

The analytics + admin-dashboard stack has been through a multi-week polish pass (`2ba50f4b` → `9f1ee31b` on `release`). The reviewer's primary brief is **[docs/internal_dashboard_analytics.md](./docs/internal_dashboard_analytics.md)**. Start there. It maps each dashboard metric to its source SQL with file:line references and lists what was fixed vs what remains.

## Don't flag these as bugs — they are deliberate

Several design choices attract reflexive LLM pushback. Before flagging, read the cited rationale.

### 1. Admin exclusion fails *open*

`AdminExclusionService.shouldTrackUser()` returns `true` (track) when `user.role` is missing or unknown — see `Server/src/services/adminExclusion.service.ts:33-46`. The cost of a spurious admin row is a noisy number. The cost of silently dropping whole subsystems of real player data because a dev forgot `relations: ['role']` is corrupt trend lines that go uncaught. Preserve this default. **Do not flag as a security bug.**

### 2. Exclusion is applied three times

Controller, worker, and query layers each filter admin roles independently. This is not redundant — each catches a different class of future regression (new write path skipping the controller; direct job enqueue; raw-SQL insert bypassing queues). All three share the role list via `AdminExclusionService.getNonTrackedRoles()`, so there is one source of truth. The docstring at the top of the service explains this.

### 3. First-party `/api/analytics` runs without marketing consent

Intentional and documented at `Client/src/utils/consent.ts:7-8`. Only the Zaraz (GA4 + Google Ads) and Meta Pixel pipelines are gated by `hasMarketingConsent()`. First-party operational analytics — the basis for product, billing, and retention metrics — are outside the marketing-consent scope. **Do not flag as a GDPR issue.** If the user asks about GDPR specifically, point them at the consent utility's top comment block rather than recommending a change.

### 4. Short game sessions are soft-deleted, not hard-deleted

`isDiscarded` column replaces a prior hard-delete path. Dashboard metrics exclude these rows via their existing `duration >= 30` filter; Total Visitors (the one metric without a duration floor) explicitly adds `isDiscarded = false`. See `Server/src/entities/Analytics.ts:109-117` and `Server/src/controllers/analyticsController.ts:653-669`. Preserving rows enables future quick-bounce analysis without re-plumbing the pipeline.

### 5. `sessionId` is per-tab and wiped on login

Intentional. Cross-tab identity would require `localStorage` (consent implications) and wouldn't buy us anything — authenticated users are keyed by `userId`, which is cross-tab. Wiping on login prevents an admin's pre-login anonymous session from contaminating their post-login authenticated analytics. See `Client/src/utils/sessionUtils.ts` (with `sessionStorage`-throws fallback) and `Client/src/layout/RootLayout.tsx:21-25`.

### 6. `trackConversion.signUp` does not re-check consent

`Client/src/utils/analytics.ts:160-162` has an explicit comment: the Meta Pixel SDK maintains its own consent state (set by the banner via `notifyVendors`), so an additional `hasMarketingConsent()` check at the call site would drift from the SDK's view. Trust the SDK boundary — double-gating introduces silent divergence.

### 7. Explicit cache invalidation AND a 3-minute TTL

Not redundant. TTL is a backstop for when an invalidation call is missed (new write path added without the call). Explicit invalidation prevents up-to-3-minute staleness on the normal path. 13 call sites currently. **Adding a new write that affects a dashboard number means adding an invalidation call.**

### 8. Past-timestamp guard is 24 hours

`MAX_PAST_TIMESTAMP_MS = 24 * 60 * 60 * 1000` in `analyticsController.ts:30`. Intentional. No legitimate client-side analytics write has a `startTime` more than 24 h in the past — heartbeats reuse the already-created row, not a fresh insert. This bounds the blast radius of a broken or tampered client clock on historical aggregations. Do not relax it.

### 9. `hasCompletedFirstLogin` appears in some metrics, not others

Intentional split. `Total Registered Users` gates on it — we care about the verified-accounts cohort. `Total Visitors` does **not** gate on it — an unverified user who is actively playing is still a visitor. §6 of the review brief covers this per-metric.

### 10. Dashboard controller is 2,716 lines

Known. Each KPI is self-contained (current / previous / all-time queries); the length scales with metric count. A shared query builder refactor has been deprioritised because the queries vary more than they look and the current shape is trivial to audit one metric at a time. **Not a review-blocker.**

## Guard against stale memory

If you are a Claude Code instance resuming a prior conversation, **verify file and line references before acting on them**. The analytics subsystem has been rewritten substantially during the polish pass — references from earlier in the project may cite files, functions, or bug locations that no longer exist. Grep the current tree before drawing conclusions.

## Sanity probes — run these before concluding a review

Each probe is a grep against the current tree. If any has drifted, the review brief is stale; investigate the divergence before recommending action.

```bash
# 1. Query-layer admin exclusion guards — expect 28
grep -c "NOT IN (:...excludedRoles)" Server/src/controllers/adminDashboardController.ts

# 2. 30-second duration floors across dashboard queries — expect 29
grep -c "duration >= :minDuration" Server/src/controllers/adminDashboardController.ts

# 3. Dashboard cache invalidation call sites — expect 13 across 6 files
grep -rn "invalidateDashboard(" Server/src/ | grep -v test | grep -v "async invalidateDashboard"

# 4. AdminExclusionService callers — there should be no hardcoded role list in workers
grep -rn "superadmin.*admin.*editor.*viewer" Server/src/workers/
# Expect: no matches. All workers go through AdminExclusionService.
```

And one end-to-end regression check against a staging / seeded DB:

```sql
-- Should return 0. Non-zero means a write path bypassed AdminExclusionService.
SELECT COUNT(*)
FROM internal.analytics a
JOIN public.users u ON a.user_id = u.id
JOIN public.roles r ON u."roleId" = r.id
WHERE r.name IN ('superadmin', 'admin', 'editor', 'viewer')
  AND a."createdAt" > NOW() - INTERVAL '7 days';
```

## Known remaining issues (don't re-flag as new findings)

These are listed in §10 of the review brief:

- `game_click` in `Client/src/hooks/useGameClickHandler.ts` bypasses the `trackEvent` helper (minor; latent since `zaraz` is never defined outside production).
- Google Ads conversions beyond `sign_up` — dashboard-side setup, not a code issue.
- GA4 custom dimensions / metrics not registered — GA4 admin work, not code.
- Server-side GA4 via Measurement Protocol — architectural follow-up, explicitly deferred.
- N+1 query pattern in `Most Played Games` (1 + 2·N) — masked by the 3-minute cache.
- `userController.ts:398-406` hardcodes `role.name === 'player'` for signup analytics instead of delegating to `AdminExclusionService` — style issue, only impacts the admin-creates-user flow.

Flag these only if the review's stated scope explicitly covers them.

## Before recommending code changes

- If the recommendation renames a column or field: grep for it across `Server/`, `Client/`, and `Server/src/migrations/`. Dashboard aggregations string-match on `activityType` values and renames cascade into the migration path.
- If the recommendation changes admin-exclusion behaviour: the fail-open default is load-bearing (§1 above). Propose the change with a concrete scenario that the current behaviour fails.
- If the recommendation adds a new activity type: update `ALLOWED_ACTIVITY_TYPES` (`analyticsController.ts:17-23`) AND the dashboard query that should pick it up — they are not coupled by type.
- If the recommendation touches caching: ensure it preserves the "write → invalidate" invariant (§7 above).
