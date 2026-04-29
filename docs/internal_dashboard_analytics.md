# Internal Dashboard Analytics — architecture and review guide

_Branch: `release`. Written 2026-04-24 for a senior-engineer review._

This document explains how the admin dashboard's numbers are produced: where data is written, how it's processed, what the dashboard endpoint computes, and which invariants must hold. §10 summarises the delta between the pre-polish state and what's shipped on this branch.

---

## 0. One-page orientation

Three independent analytics pipelines run side-by-side in this app. This document covers **only the first**:

| Pipeline | Destination | Production-only? | Covered here |
| --- | --- | --- | --- |
| **Internal API → PostgreSQL** | `/admin` dashboard | No — all envs | ✅ yes |
| Cloudflare Zaraz → GA4 + Google Ads | Marketing tools | Yes — `arcadesbox.com` only | Referenced in §8 for context |
| Meta Pixel (direct) | Meta Ads Manager | Yes — `arcadesbox.com` only | Referenced in §8 for context |

The internal pipeline is **first-party, always-on, admin-excluded**. It is the source of truth for product/retention/billing questions. It is intentionally not the source of truth for marketing/acquisition questions — see `docs/ga4_vs_dashboard.md` for why the two never reconcile.

**The critical invariant:** every number on `/admin` reflects activity by *non-staff* users. The `AdminExclusionService` is the load-bearing mechanism; see §4.

---

## 1. Data model

### 1.1 Primary table — `internal.analytics`

Entity: `Server/src/entities/Analytics.ts`. One row per tracked event. Five allow-listed `activityType` values share the table:

| Column | Type | Populated for | Notes |
| --- | --- | --- | --- |
| `id` | UUID PK | all | Returned to the client so it can PUT heartbeats/end |
| `user_id` | FK User, nullable | authenticated only | JOIN to `users` → `roles` for admin exclusion |
| `session_id` | varchar(255), nullable | anonymous only | Client-generated UUID, per-tab, wiped on login |
| `country` | varchar(100), nullable | anonymous only | IP-resolved by the worker; authenticated users inherit country from their user profile via JOIN |
| `game_id` | FK Game, nullable | `game_session` only | Nullable on purpose for signups / logins / homepage visits |
| `activityType` | varchar(50) | all | One of `game_session`, `homepage_visit`, `Signed up`, `Signed up from invitation`, `Logged in` (see §2.1) |
| `startTime` | timestamp, nullable | `game_session`, `homepage_visit` | Client-provided; validated against clock skew |
| `endTime` | timestamp, nullable | `game_session` (after end), `homepage_visit` (=startTime) | |
| `duration` | int seconds | whenever both times present | Auto-computed in `@BeforeInsert`/`@BeforeUpdate` (`Analytics.ts:126-147`) |
| `sessionCount` | int, default 1 | `game_session` | Reserved for future reload-count feature |
| `exitReason` | varchar(50), nullable | `game_session` | `route_change`, `tab_hidden`, `page_unload`, `user_action` |
| `loadTime` | int ms, nullable | `game_session` | Iframe onLoad time |
| `milestone` | varchar(50), nullable | `game_session` | Latest checkpoint: `30s` / `1m` / `5m` / `10m` |
| `lastSeenAt` | timestamp, default now | `game_session` | Bumped every 15 s by heartbeat |
| `endedAt` | timestamp, nullable | `game_session` after end | Mirror of `endTime` |
| `is_discarded` | boolean, default false | `game_session` with `duration < 30` | Soft-delete marker; see §2.5 |
| `createdAt` / `updatedAt` | timestamps | all | TypeORM defaults; `createdAt` is the canonical period field |

**Indexes** (`Analytics.ts:23-32`): composite `(createdAt, userId, sessionId, duration)`, `(createdAt, gameId, duration)`, `(createdAt, duration)`, plus single-column indexes on every filterable column. The three composites are designed for the dashboard's hot paths — the distinct-user count over a time range is the most expensive query in the system.

### 1.2 Companion tables

| Entity | Table | Purpose | Admin-excluded? |
| --- | --- | --- | --- |
| `SignupAnalytics` | `public.signup_analytics` | Button-click signals keyed by source (`navbar`, `signup-modal`, `keep-playing`) | Yes at controller |
| `GamePositionHistory` | `public.game_position_history` | Click counts for the tile-popularity heatmap | No — product UX signal, not user metric |
| `GameLike` | `public.game_likes` | Per-user per-game like record | No — product UX signal |

---

## 2. Write paths

### 2.1 The allow-list — `analyticsController.ts:17-23`

```ts
const ALLOWED_ACTIVITY_TYPES = new Set<string>([
  'game_session',
  'homepage_visit',
  'Signed up',
  'Signed up from invitation',
  'Logged in',
]);
```

Case-sensitive. `POST /api/analytics` rejects anything else with 400. Dashboard queries assume these exact strings. **When adding a new activity type, update this set AND the dashboard query that should pick it up; they're not coupled by type.**

### 2.2 Timestamp validation — `analyticsController.ts:25-39`

- Rejects timestamps more than **60 seconds in the future** (clock-skew guard).
- Rejects timestamps more than **24 hours in the past** (`MAX_PAST_TIMESTAMP_MS`) to bound the blast radius of a broken/tampered client clock on historical aggregations.
- Both bounds apply to `startTime` and `endTime` on `POST /api/analytics`.

### 2.3 Game sessions

| Step | Endpoint | Client site | Server site | Side effects |
| --- | --- | --- | --- | --- |
| Create | `POST /api/analytics` | `GamePlay.tsx:260` via `useCreateAnalytics()` (`Client/src/backend/analytics.service.ts`) | `analyticsController.ts:85-160` | Enqueues `analytics-processing` job; `waitUntilFinished` so client gets row `id` for subsequent calls |
| Heartbeat | `POST /api/analytics/:id/heartbeat` | `GamePlay.tsx:322-341` (every 15 s) | `analyticsController.ts:565-589` | Updates `lastSeenAt`. Returns **410 Gone** if the row is absent (discarded short session) so the client stops the interval. |
| Milestone | `PUT /api/analytics/:id` | `GamePlay.tsx:306-313` | Generic update endpoint | Sets `milestone` column (`30s`/`1m`/`5m`/`10m`) |
| iframe load | `PUT /api/analytics/:id` | `GamePlay.tsx:557` | Generic update endpoint | Sets `loadTime` |
| End | `POST /api/analytics/:id/end` | `GamePlay.tsx:363-367, 401-471` | `analyticsController.ts:620-682` | Sets `endTime`, `endedAt`, `exitReason`. Computes `duration`. If `duration < 30` and `gameId IS NOT NULL`, marks `isDiscarded = true` (soft-delete). Invalidates dashboard cache. |

### 2.4 Homepage visits

- Client: `Client/src/layout/RootLayout.tsx:30-75` — fires on every SPA `location` change and whenever `user` transitions (login/logout). Uses `fetch(..., { keepalive: true })` so it survives page unload.
- **Client-side throttle** (`RootLayout.tsx:11, 17, 41-44`): `HOMEPAGE_VISIT_THROTTLE_MS = 30_000`. A `lastBeaconRef` keyed on `u:<userId>` or `s:<sessionId>` suppresses duplicate beacons inside the window. Auth-state transitions bypass the throttle because the key changes from session-based to user-based.
- Server: `analyticsController.ts:760-799` — admin-excludes at the controller level (short-circuits with 202), then enqueues the `homepage-visit` job.

### 2.5 Short-session soft-delete — `analyticsController.ts:653-669`

When `POST /api/analytics/:id/end` resolves to `duration < 30` on a game session, the row is **not deleted**. It's marked `isDiscarded = true`. The rationale is in the entity comment (`Analytics.ts:109-114`):

- Every dashboard query except Total Visitors already filters `duration >= 30`, so discarded rows are excluded implicitly.
- Total Visitors explicitly adds `analytics.isDiscarded = false` (see `adminDashboardController.ts:866, 887`).
- Preserving the row enables future product analysis of quick-bounce patterns (broken games, long iframe loads, etc.) without re-plumbing the pipeline.

The heartbeat 410 in §2.3 is the other half of this: when a client is still heartbeating against a discarded row, the controller tells the client to stop rather than silently absorbing the writes.

### 2.6 Signups and logins — server-side direct inserts

Not queued. Written synchronously inside the auth flow:

| Activity | Location | `activityType` |
| --- | --- | --- |
| Regular signup | `authController.ts:104-110` | `'Signed up'` |
| Invitation signup | `authController.ts:213-222` | `'Signed up from invitation'` |
| Admin-created player | `userController.ts:398-406` | `'Signed up'` (only when `role.name === 'player'`) |
| Login (returning) | `authController.ts:298-306` | `'Logged in'` |
| Login (first-time, no OTP) | `authController.ts:336-345` | `'Logged in'` |
| OTP verify (first login) | `authController.ts:504-514` | `'Logged in'` |

Each call site goes through `AdminExclusionService.shouldTrackUser()` before inserting and calls `cacheService.invalidateDashboard()` after. Refresh-token is intentionally not recorded — it's silent infra, not a user event.

### 2.7 Signup button clicks — separate table

`POST /api/signup-analytics/click` in `signupAnalyticsController.ts` writes to `public.signup_analytics`. Keyed by button source (`navbar`, `signup-modal`, `keep-playing`), IP-resolved country, and device type. This table feeds the "Click insights" panel on the dashboard (`GET /api/signup-analytics/data`) and is **distinct** from signup *completions* in `analytics` — reconciling the two is how the UI computes the funnel drop-off between click and registered.

### 2.8 Rate limiting — `middlewares/rateLimitMiddleware.ts:171-205`

`analyticsLimiter` on every write endpoint:
- 500 events/minute per key
- Key priority: `userId` > `sessionId` > `req.params.id` > IP
- Redis-backed, falls open if Redis is down (documented graceful degradation)
- Skipped in `NODE_ENV=development|test` for load-testing

---

## 3. Async architecture — BullMQ queues

Four queues are defined in `Server/src/services/queue.service.ts`; each has a dedicated worker. Concurrency 5, retries 3 with exponential backoff.

| Queue | Worker | Writes to | Admin-excludes? |
| --- | --- | --- | --- |
| `analytics-processing` | `workers/analytics.worker.ts` | `internal.analytics` | **Yes** — re-checks via `AdminExclusionService.shouldTrackUser(user)` (`line 53`), returns placeholder `{ id: 'admin-excluded' }` if excluded |
| `homepage-visit` | `workers/homepageVisit.worker.ts` | `internal.analytics` | **Yes** — same service call (`line 31`) |
| `click-tracking` | `workers/clickTracking.worker.ts` | `game_position_history` | No (product signal) |
| `like-processing` | `workers/like.worker.ts` | `game_likes` | No (product signal) |

**Why the worker re-checks even though the controller already did:** it's a safety net. A future code path could enqueue a job without going through the controller; the worker is the last gate before the DB row exists. The worker calls the same `AdminExclusionService` (`shouldTrackUser` with the pre-loaded user, not the async `shouldTrack` that re-queries) so controller and worker remain a single source of truth. No hardcoded role lists in workers.

The analytics worker also:
- Resolves country from IP via `getCountryFromIP()` for anonymous rows only (`analytics.worker.ts:75-85`).
- Calls `cacheService.invalidateDashboard()` after every save (`line 101`).

---

## 4. The admin exclusion invariant

This is the most important piece of the system. Every dashboard metric must exclude staff activity, and this is enforced at three layers.

### 4.1 The service — `services/adminExclusion.service.ts` (54 lines, read it all)

```ts
const NON_TRACKED_ROLES = Object.freeze(['superadmin', 'admin', 'editor', 'viewer']);

// Called when you already have the User object.
static shouldTrackUser(user?: User): boolean {
  if (!user) return true;                   // anonymous → track
  const roleName = user.role?.name;
  if (!roleName) return true;               // role missing → FAIL OPEN
  return !NON_TRACKED_ROLES.includes(roleName);
}

// Called when you only have the userId — performs a DB lookup.
static async shouldTrack(userId?: string): Promise<boolean> { ... }
```

### 4.2 The fail-open default is load-bearing

Comment at `adminExclusion.service.ts:33-37`: _"If role is unknown or missing, we TRACK (fail open for analytics) to avoid data loss on edge cases."_

Rationale: a developer who forgets to load the `role` relation on the User should not silently lose analytics for an entire subsystem. The cost of accidentally tracking an admin once is a noisy number; the cost of silently dropping real player data is corrupt trend lines that go uncaught. Preserve this behaviour.

### 4.3 The three layers

1. **Controller layer.** Every write path calls `shouldTrackUser` before enqueuing/inserting. Silent no-op if excluded (usually a 202 response so the client doesn't treat it as an error).
2. **Worker layer.** `analytics.worker.ts:52-73` and `homepageVisit.worker.ts:30-37` re-check via DB lookup. Catches direct-enqueue bypasses.
3. **Query layer.** Every aggregation in `adminDashboardController.ts` joins `analytics → user → role` and filters:
   ```sql
   (role.name NOT IN (:...excludedRoles) OR analytics.userId IS NULL)
   ```
   grep count at time of writing: 28 occurrences in that file. `excludedRoles` comes from `AdminExclusionService.getNonTrackedRoles()` (`adminDashboardController.ts:54`) — the role list is no longer duplicated.

The `OR analytics.userId IS NULL` clause preserves anonymous rows (which have no user to join to).

### 4.4 Client-side — session-id wipe on login

`Client/src/layout/RootLayout.tsx:21-25`:
```tsx
useEffect(() => { if (user) clearSessionId(); }, [user]);
```

This wipes `sessionStorage.visitor_session_id` at login. Without it, an admin who'd been browsing anonymously in another tab could carry their pre-login sessionId into the authenticated session, and the admin-exclusion role filter wouldn't catch rows keyed only on that sessionId.

### 4.5 Regression check

Run this periodically (or wire into CI against a seeded DB). It should return 0:

```sql
SELECT COUNT(*)
FROM internal.analytics a
JOIN public.users u ON a.user_id = u.id
JOIN public.roles r ON u."roleId" = r.id
WHERE r.name IN ('superadmin', 'admin', 'editor', 'viewer')
  AND a."createdAt" > NOW() - INTERVAL '7 days';
```

Non-zero means a write path bypassed the service — worker-level fail-safe lets this happen if a row is inserted via raw SQL or a new controller that skips exclusion.

---

## 5. Read paths

### 5.1 Primary endpoint — `GET /api/admin/dashboard`

Route: `routes/adminRoutes.ts:48`. Role gate: `isAdmin`. Rate limit: `adminLimiter` (300/min).

Controller: `adminDashboardController.ts:46-1160`. Query parameters:
- `period` — `last24hours` (default), `last7days`, `last30days`, `custom`
- `startDate`/`endDate` — required when `period=custom`; interpreted as calendar dates in the user's timezone (not UTC)
- `country[]` — array; filters authenticated rows by user-profile country OR anonymous rows by IP-resolved country
- `timezone` — IANA zone, defaults to `UTC`

### 5.2 Period boundaries — `utils/timezonePeriod.ts`

The dashboard's period arithmetic is non-trivial and has been explicitly fixed once (see the comment block at `timezonePeriod.ts:44-59`). The correct sequence is:

1. Resolve today's calendar date **as the user sees it**: `toZonedTime(nowUtc, tz)` → extract `YYYY-MM-DD` via UTC accessors on the zoned container.
2. Walk the calendar DATE back by integer days via `setUTCDate` on a UTC-anchored container. Every UTC day is exactly 24 h, so this walks calendar days cleanly.
3. Only at the end, resolve "midnight on that date in the user's timezone" to a UTC instant via `fromZonedTime`.

This produces correct boundaries across DST transitions. The previous `setHours(0,0,0,0)` approach operated in server-local time (UTC on ECS) and silently discarded the timezone shift — the timezone filter was decorative. That bug is fixed and there's a regression test scenario list in the commit that introduced it (`2ba50f4b fix(analytics): honor user timezone in dashboard period boundaries`).

`parseCustomDayBoundary()` is the sibling for user-supplied `startDate`/`endDate` — same principle: interpret the date string as a calendar day in the user's timezone.

### 5.3 Caching — 3-minute TTL with write invalidation

Cache key (`adminDashboardController.ts:66`):
```
${period}:${countries.sort().join(',')}:${timezone}
```

Get: `cacheService.getAnalytics('dashboard', cacheKey)`.
Set: deferred (whole response cached after all queries run).
TTL: 3 minutes.

Invalidation: `cacheService.invalidateDashboard()` is called after every write that could change a dashboard number:

| Location | Why |
| --- | --- |
| `workers/analytics.worker.ts:101` | After every analytics insert |
| `workers/homepageVisit.worker.ts:52` | After every homepage-visit insert |
| `controllers/authController.ts:110, 222, 306, 345, 514` | After signup / login analytics writes |
| `controllers/userController.ts:406` | After admin-created player signup |
| `controllers/analyticsController.ts:504, 530, 660, 673, 727` | After update/end/discard/delete |

Goal: any write that could flip a number flushes cache, so admins never see stale data past the next read. Previous behaviour (TTL-only invalidation) left dashboards up to 3 min stale; this is now event-driven with TTL as a backstop.

### 5.4 Companion read endpoints — `routes/adminRoutes.ts:48-174`

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `GET /admin/dashboard` | admin | Main KPI payload |
| `GET /admin/games-popularity` | admin | Click heatmap from `game_position_history` |
| `GET /admin/games-analytics` | **editor** | Game list with per-game aggregates |
| `GET /admin/games/:id/analytics` | editor | Single-game detail |
| `GET /admin/users-analytics` | admin | User list with per-user aggregates |
| `GET /admin/users/:id/analytics` | admin | Single-user detail |
| `GET /admin/user-activity-log` | admin | Chronological activity feed |
| `POST /admin/check-inactive-users` | admin | Trigger the inactive-user cron manually |
| `GET /api/signup-analytics/data` | admin | Signup button breakdowns |

Editors get access to `games-analytics` and per-game detail but **not** to user-level data or the main dashboard. Viewers get nothing admin-side (they're effectively read-only `player` from the analytics perspective).

---

## 6. Metrics catalog

Every metric in this section is computed by `adminDashboardController.ts`. I've cited line ranges and called out the SQL shape. Percentage-change fields are clamped to `[-100, 100]` to stop outlier-period comparisons (e.g. first week after launch) from rendering silly numbers.

| # | Metric | Definition | File:line | Shape |
| --- | --- | --- | --- | --- |
| 1 | **Total Unique Visitors** | `COUNT(DISTINCT COALESCE(userId, sessionId))` over `(gameId IS NOT NULL OR activityType = 'homepage_visit') AND isDiscarded = false` in period | `:849-930` | Includes homepage visits so it aligns conceptually with GA4's "Users." Country filter respects anonymous via `analytics.country`. `isDiscarded` filter added because this is the one metric without a duration floor. |
| 2 | **Total Unique Players** | `COUNT(DISTINCT COALESCE(userId, sessionId))` over `gameId IS NOT NULL AND duration >= 30` in period | `:434-486` | The cleanest metric. 30 s floor is the dividing line between "visitor" and "player". |
| 3 | **Daily Active Players (DAP)** | Same as Unique Players but fixed to rolling 24 h regardless of selected period | `:228-249` | Allows the dashboard to always show "who's playing today?" next to the period-scoped metrics. |
| 4 | **Daily Anonymous Players** | `COUNT(DISTINCT sessionId)` over `sessionId IS NOT NULL AND userId IS NULL AND gameId IS NOT NULL AND duration >= 30` in rolling 24 h | `:824-847` | Renamed from "Daily Anonymous Visitors" (was misleading — it's always required gameId + 30 s). |
| 5 | **Total Game Sessions** | `COUNT(*)` over `gameId IS NOT NULL AND duration >= 30` in period | `:488-555` | Also returns an all-time `actualSessions` for internal sanity checks. |
| 6 | **Total Gameplay Time** | `SUM(duration)` with same filters as Total Game Sessions, filtered by `createdAt` | `:540-619` | Previously filtered by `startTime` (inconsistent with siblings) — fixed; now uses `createdAt` on all three query variants. |
| 7 | **Average Session Duration** | `AVG(duration)` where duration ≥ 30 | `:756-821` | |
| 8 | **Most Played Games (top 3)** | Group by `gameId`, `COUNT(*) DESC LIMIT 3`, with per-game `{current, previous, percentageChange}` | `:621-751` | Filters `createdAt BETWEEN start AND end` (previously used `>` without upper bound — fixed). N+1 pattern still present: 1 + 2·N queries for the top 3. Cache masks it. |
| 9 | **Game Coverage** | `COUNT(DISTINCT gameId) / COUNT(active games) × 100` | `:348, :362-429` | Denominator is `gameRepository.count({ where: { status: GameStatus.ACTIVE }})` — previously counted disabled games too. |
| 10 | **Retention Rate** | Yesterday's players (24–48 h ago) who also played in the last 24 h, / yesterday's players | `:139-218` | Uses an `EXISTS` subquery with a proper `BETWEEN` upper bound on the outer query (previously `>` only). Raw SQL in the subquery with parameterised values. |
| 11 | **Total Registered Users** | Users with `hasCompletedFirstLogin = true AND isDeleted = false` created in period | `:251-299` | `hasCompletedFirstLogin` is the correct gate *here* — we care about verified accounts, not Total Visitors. |
| 12 | **Registered But Never Logged In** | Users with `hasCompletedFirstLogin = false` | `:305-330` | Surfaces the OTP-drop-off cohort separately. |
| 13 | **Guest Sessions / Guest Time Played** | Mirrors Total Sessions / Total Gameplay Time with `userId IS NULL` | around `:930-1060` | |
| 14 | **User Type Breakdown** | Authenticated vs anonymous split for sessions and time-played | `:1061-1090` | Renders as twin pie charts. |
| 15 | **Signup Click Insights** | Separate endpoint (`/api/signup-analytics/data`) → `signup_analytics` table → breakdowns by country / device / day / button source | `signupAnalyticsController.ts` | Conversion rate computed client-side as `(totalClicks − registeredInPeriod) / totalClicks`. |

---

## 7. Client-side data collection

### 7.1 Session ID lifecycle — `Client/src/utils/sessionUtils.ts`

- Storage: `sessionStorage.visitor_session_id`.
- Fallback: in-memory `inMemorySessionId` when `sessionStorage` throws (Safari private mode, enterprise-locked browsers, sandboxed iframes). Without this fallback every pageview would mint a fresh UUID and inflate anonymous-visitor counts.
- Per-tab by browser spec — two tabs = two sessionIds = two distinct anonymous visitors for the dashboard. This is intentional; we don't attempt cross-tab identity because (a) we'd have to share through `localStorage` and play consent games, and (b) the analytics system already handles authenticated users via `userId`, which *is* cross-tab.
- Wiped on login (see §4.4).

### 7.2 Homepage-visit beacon — `RootLayout.tsx`

- Fires on `location` change and on `user` transition.
- Throttled client-side to 30 s per identity key.
- Uses `fetch(..., { keepalive: true })` — semantically equivalent to `navigator.sendBeacon` but supports auth headers and the JSON body we need.
- Does not block the nav — `fetch` promise is fire-and-forget with a dev-only error log.

### 7.3 Game-session event cadence — `Client/src/pages/GamePlay/GamePlay.tsx`

Timeline of a typical game session:

```
t=0     Mount                    POST /api/analytics               → row created, id returned
t=0     Mount (second useEffect) trackGameplay.gameStart            → Zaraz → GA4 (prod only)
t=~2s   iframe onLoad            PUT  /api/analytics/:id {loadTime} → column updated
t=15    Heartbeat                POST /api/analytics/:id/heartbeat  → lastSeenAt bump
t=30    Milestone 30s            PUT  /api/analytics/:id {milestone='30s'}
t=60    Milestone 1m             PUT  /api/analytics/:id {milestone='1m'}
t=300   Milestone 5m             PUT  /api/analytics/:id {milestone='5m'}
t=600   Milestone 10m            PUT  /api/analytics/:id {milestone='10m'}
...     Heartbeat every 15s
t=X     Unmount / route change /
        tab hidden / unload      POST /api/analytics/:id/end {endTime, exitReason}
                                 If duration < 30 → row marked isDiscarded
```

### 7.4 The 30-second floor — belt-and-braces

Three places enforce it:

1. **Write**: `updateAnalyticsEndTime` marks `isDiscarded = true` if `duration < 30` (`analyticsController.ts:657`).
2. **Read**: every dashboard aggregation query adds `analytics.duration >= 30`.
3. **Visitor aggregation**: Total Visitors explicitly excludes discarded rows with `isDiscarded = false`.

A short session still exists in the DB — it's just filtered out of every dashboard metric. A future product view that wants to surface quick-bounces can query it directly.

---

## 8. Third-party emission (Zaraz + Meta Pixel) — context only

Summary of what interacts with the internal dashboard:

- **Consent banner** (`Client/src/utils/consent.ts`) writes `localStorage.cookieConsent` (`'accepted' | 'declined' | 'pending'`) and propagates to both Zaraz (`zaraz.consent.set`) and Meta Pixel (`fbq('consent', ...)`).
- **The analytics gate** `isAnalyticsEnabled()` in `Client/src/utils/analytics.ts:18-25` requires three things: production domain, Zaraz SDK loaded, `hasMarketingConsent() === true`. Marketing-consent is the load-bearing gate today because Cloudflare-side tool configuration may not yet enforce a consent purpose; the comment at `utils/analytics.ts:14-17` calls this out.
- **First-party `/api/analytics` is deliberately NOT consent-gated.** It's operational (used for product/billing/retention), not marketing. `consent.ts:7-8` spells this out.
- **The only crossover in the dashboard:** Total Visitors intentionally matches GA4's "Users" definition (includes homepage visits), and the percentage-change comparisons work the same way. But reconciling absolute numbers is explicitly not a goal — see `docs/ga4_vs_dashboard.md` for the eight reasons they diverge (ad blockers, admin exclusion, environment gating, bot filtering, 30 s floor, consent, identity model, timezone).

---

## 9. What to check as a reviewer

Checklist for someone sitting down to scrutinise this:

1. **Admin-exclusion regression SQL** (§4.5). Should return 0. If it doesn't, find the write path that bypassed the service.
2. **Cache-invalidation coverage.** `grep -r 'invalidateDashboard' Server/src/` currently shows 13 call sites. Any new write path that affects a dashboard number needs one too.
3. **Period-boundary determinism.** For `last24hours` with `timezone=Europe/Nicosia` vs `timezone=UTC`, the two should return *different* numbers. If they return the same, `utils/timezonePeriod.ts` is being bypassed. `2ba50f4b` and `e63650b1` have the rationale.
4. **30-second floor.** Assert that `duration >= 30` appears in every dashboard aggregation query that isn't Total Visitors. Currently 29 occurrences in `adminDashboardController.ts`; losing one flips a metric.
5. **Homepage-visit throttle.** Navigate SPA routes quickly as an anonymous user in a fresh incognito. Server should receive **one** `homepage-visit` beacon per 30 s window per sessionId.
6. **Allow-list coverage.** The five `activityType` values in `ALLOWED_ACTIVITY_TYPES` must each have a corresponding write path AND a corresponding place where the dashboard either consumes or correctly ignores them.
7. **Soft-delete observability.** `SELECT COUNT(*) FROM internal.analytics WHERE is_discarded = true AND "createdAt" > NOW() - INTERVAL '1 day'` shows the quick-bounce volume. Big jumps may indicate a broken game.
8. **Consent banner end-to-end.** Decline → no Zaraz events, no Meta events. Accept → both fire. Internal `/api/analytics` fires in either case.

---

## 10. Known gaps (most fixed; some remain)

A pre-polish critique listed 11 critical + ~20 major/minor issues. As of this branch, most are shipped:

| Issue from deep review | Status | Evidence |
| --- | --- | --- |
| Period-boundary UTC bug | ✅ Fixed | `utils/timezonePeriod.ts` (2ba50f4b, e63650b1) |
| Total Time Played filters `startTime` not `createdAt` | ✅ Fixed | `adminDashboardController.ts:551, 566` now `createdAt` |
| Country filter on Total Visitors lets anonymous pass | ✅ Fixed | `:897-906` now filters `analytics.country` too |
| `hasCompletedFirstLogin` gate on Total Visitors | ✅ Fixed | Removed from Total Visitors; still (correctly) on Total Registered Users |
| "Daily Anonymous Visitors" misnamed | ✅ Fixed | Renamed to "Daily Anonymous Players" across query + response |
| Hard-delete of <30 s sessions | ✅ Fixed | Soft-delete via `isDiscarded` column |
| Game Coverage counts disabled games | ✅ Fixed | `gameRepository.count({ where: { status: GameStatus.ACTIVE }})` |
| Retention outer query `>` no upper bound | ✅ Fixed | Now `BETWEEN :outerStart AND :outerEnd` |
| Most Played Games inner `>` no upper bound | ✅ Fixed | Now `BETWEEN :start AND :end` |
| Heartbeat returns 204 on missing row | ✅ Fixed | Returns 410 Gone |
| Duplicated hardcoded role lists in workers | ✅ Fixed | Workers call `AdminExclusionService.shouldTrackUser` |
| StatsCard `as any` cast | ✅ Fixed | `StatsCard.tsx:50` uses typed payload |
| Homepage-visit flood no dedup | ✅ Fixed | 30 s client-side throttle in `RootLayout.tsx` |
| Clock-skew guard is one-sided | ✅ Fixed | `isAncientTimestamp` added (24 h lower bound) |
| `sessionStorage.setItem` throws in private | ✅ Fixed | `sessionUtils.ts` wraps with safe helpers + in-memory fallback |
| Consent banner not wired | ✅ Fixed | `consent.ts` + `setConsent`/`syncConsentToVendors` + Pixel/Zaraz gates |
| Dashboard cache never invalidates | ✅ Fixed | 13 invalidation call sites |
| `game_click` bypasses `trackEvent` helper | ⚠️ Still present | `useGameClickHandler.ts:65` calls `zaraz.track` directly |
| Google Ads conversions beyond `sign_up` not wired | ⚠️ Dashboard-side work | `game_click`, `game_start`, `game_milestone` Zaraz actions need creating in Cloudflare — no code change |
| Custom GA4 dimensions not registered | ⚠️ GA4 admin work | Blocks aggregate reporting on `duration`, `load_time`, etc. |
| Server-side GA4 (Measurement Protocol) | ❌ Not started | Biggest lever for GA4↔dashboard reconciliation (`ga4_vs_dashboard.md:68-74`) |
| Enhanced conversions for Ads | ❌ Not started | Hashing email/phone into `user_data` before emit |
| Bot filtering on dashboard | ❌ Not started | Currently no known-bot list |
| N+1 in Most Played Games | ⚠️ Tolerated | 1 + 2·N queries; masked by 3-min cache |
| `userController.ts` hardcodes `role.name === 'player'` for signup tracking | ⚠️ Style issue | Should delegate to `AdminExclusionService.shouldTrackUser`, but only impacts a non-default admin-creates-user flow |

**Summary for a reviewer:** the on-metrics correctness and the admin-exclusion invariant are in good shape; the remaining items are either (a) not-our-code (Cloudflare/GA4 dashboard configuration), (b) architectural follow-ups that need product buy-in (server-side GA4, bot filtering), or (c) minor polish that doesn't distort numbers.

---

## 11. File map

Read in this order to get up to speed:

| File | What it gives you |
| --- | --- |
| `Server/src/services/adminExclusion.service.ts` (54 lines) | The invariant — read first |
| `Server/src/entities/Analytics.ts` (148 lines) | The data model |
| `Server/src/controllers/analyticsController.ts` | All write endpoints + allow-list + timestamp validation + soft-delete + heartbeat 410 |
| `Server/src/workers/analytics.worker.ts` | Async insert path + country resolution |
| `Server/src/workers/homepageVisit.worker.ts` | Page-visit insert path |
| `Server/src/utils/timezonePeriod.ts` | Period-boundary math (the subtle one) |
| `Server/src/controllers/adminDashboardController.ts` (2,716 lines) | Every KPI query lives here; jump to §6 metric line ranges |
| `Server/src/routes/adminRoutes.ts` + `analyticsRoutes.ts` | The HTTP surface |
| `Server/src/middlewares/rateLimitMiddleware.ts:171-205` | `analyticsLimiter` config |
| `Client/src/layout/RootLayout.tsx` | Homepage-visit beacon + throttle + session-id wipe |
| `Client/src/utils/sessionUtils.ts` | Session-id lifecycle + storage fallback |
| `Client/src/pages/GamePlay/GamePlay.tsx` | Session cadence (create/heartbeat/milestone/end) |
| `Client/src/utils/analytics.ts` + `Client/src/utils/consent.ts` + `Client/src/analytics.ts` | Third-party pipeline + consent wiring (§8 context) |
| `Client/src/pages/Admin/Home/StatsCard.tsx` + siblings | Dashboard UI |
| `docs/ga4_vs_dashboard.md` | Stakeholder-facing "why GA4 and the dashboard disagree" one-pager |
| `docs/zaraz_setup_runbook.md` | Cloudflare-side configuration (not in code) |
