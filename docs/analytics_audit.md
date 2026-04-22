# Analytics Stack Audit

_Audit date: 2026-04-17. Branch: `main`._

A walkthrough of every analytics/tracking pixel and dashboard metric in the
codebase, what currently flows where, and what to expect when comparing
GA4 to the in-house admin dashboard.

---

## 1. What's actually integrated

### 1.1 Cloudflare Zaraz → GA4 (production only)

- Entry point: `Client/src/utils/analytics.ts`
- Gate: `window.shouldLoadAnalytics === true && typeof window.zaraz !== 'undefined'`
  (`isAnalyticsEnabled`, lines 9-15)
- Production-only by hostname check in `Client/src/analytics.ts:4-10`
  (`arcadesbox.com`, `www.arcadesbox.com`). Dev/staging never fire Zaraz.
- Zaraz config (GA4 measurement ID, destination mappings, consent) lives in
  the **Cloudflare dashboard**, not in this repo. There is no `wrangler.toml`,
  `zaraz.json`, or equivalent checked in.
- Direct `gtag.js` and Google Tag Manager integrations are removed —
  `Client/index.html:20` and `Client/index.html:93` carry the
  `MIGRATED TO ZARAZ` comments. The legacy Google Ads ID `AW-17063551057`
  exists only in dead-commented HTML.

Callers that emit Zaraz events (`grep` for `trackEvent|trackGameplay|trackInteraction|window.zaraz`):

- `Client/src/pages/GamePlay/GamePlay.tsx`
- `Client/src/components/single/GameInfoSection.tsx`
- `Client/src/components/single/AllGamesSection.tsx`
- `Client/src/utils/analytics.ts` (definitions only)

### 1.2 Facebook Pixel (production only)

- Pixel ID: `1940362026887774` (`Client/src/analytics.ts:50`)
- Loaded with a 2-second `setTimeout` after `window.load` to avoid blocking LCP
- Single event: `fbq('track', 'PageView')` at `Client/src/analytics.ts:52`
- Re-fires on SPA route change in `Client/src/layout/RootLayout.tsx:74`
- **No conversion events fire** — searched for `Purchase`, `Lead`,
  `CompleteRegistration`, `Subscribe`, `AddToCart`, `gtag_report_conversion`,
  `send_to`. None present in app code.

### 1.3 In-house analytics (all environments)

- Write path: client controllers → BullMQ `analyticsProcessor` → PostgreSQL
  `analytics` table.
- Admin/staff users excluded at every write path via `AdminExclusionService`
  (`Server/src/services/adminExclusion.service.ts`). Excluded roles:
  `superadmin`, `admin`, `editor`, `viewer`. `player` and anonymous sessions
  are tracked.
- Anonymous sessions identified by a client-generated `sessionId` stored in
  `sessionStorage`, **wiped on login** (`Client/src/layout/RootLayout.tsx`)
  to prevent admin contamination after sign-in.
- Allowed `activityType` values are enforced by an allow-list in
  `analyticsController.ts` (`ALLOWED_ACTIVITY_TYPES`).

---

## 2. Events sent to GA4 (via Zaraz)

Defined in `Client/src/utils/analytics.ts:40-163`.

| Zaraz event             | Params                                                                                                | Trigger                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `game_start`            | `game_id`, `game_title`, `event_category`, `event_label`                                              | Game session begins                                |
| `game_end`              | + `duration` (s)                                                                                      | Game session ends normally                         |
| `game_milestone`        | + `milestone`, `duration`                                                                             | Session checkpoint reached                         |
| `game_loaded`           | + `load_time` (ms)                                                                                    | Game iframe finished loading                       |
| `game_exit`             | + `duration`, `reason`                                                                                | User leaves game early                             |
| `game_share`            | + `share_method` (`web_share`/`clipboard`/`whatsapp`/`facebook`)                                      | User shares a game                                 |
| `see_more_games`        | `page`, `category`, `total_games_loaded`                                                              | "See More Games" pagination clicked                |
| `back_to_top_all_games` | `category`, `total_games_loaded`                                                                      | "Back to Top" clicked in All Games                 |

`page_view` is auto-collected by Zaraz's GA4 connector when configured —
the app does not send it explicitly.

### How these surface in the GA4 console

- **Reports → Engagement → Events** — every Zaraz event shows up here as a
  custom event. Counts and event-count-per-user are available out of the box.
- **Custom dimensions/metrics** — params like `game_id`, `game_title`,
  `milestone`, `share_method`, `category`, `reason` will not appear in
  reports until registered under **Admin → Custom definitions**. Numeric
  params (`duration`, `load_time`, `total_games_loaded`) should be registered
  as custom **metrics** (not dimensions) so GA4 can sum/avg them.
- **`event_category` / `event_label`** are GA Universal Analytics conventions.
  In GA4 they're treated as plain custom params with no special meaning.
  Either register them as custom dimensions or stop sending them.
- **DebugView** — append `?_dbg=1` to any production URL (Zaraz forwards in
  debug mode) to verify events live.

---

## 3. Ad conversions: not tracked

**No ad conversion event fires from this codebase.**

| Channel             | Status                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Google Ads          | `AW-17063551057` is in dead-commented HTML. No active gtag conversion. No Zaraz Ads tag in repo. |
| Meta (Facebook) Ads | Pixel loads, only `PageView` fires. No `Purchase`/`Lead`/`CompleteRegistration`.                |
| TikTok Ads          | Not integrated.                                                                              |
| LinkedIn Insight    | Not integrated.                                                                              |
| Reddit Pixel        | Not integrated.                                                                              |
| X / Twitter Pixel   | Not integrated.                                                                              |
| Pinterest Tag       | Not integrated.                                                                              |
| Microsoft UET (Bing)| Not integrated.                                                                              |

**Implications**

- **Google Ads → Conversions** will report **zero** for signup, first-game-played,
  and purchase-style events. Smart Bidding, Target CPA, and Maximize Conversions
  cannot optimize against these events.
- **GA4 → Key Events** (the GA4 successor to "Conversions") will only contain
  the gameplay events above plus auto-collected `page_view`. None are flagged as
  Key Events until you mark them in GA4 admin.
- **Meta Ads Manager** can only build PageView audiences; no Lead or
  CompleteRegistration optimization, no value-based bidding.

**Minimum viable fix to get conversions firing**

1. After successful signup verification, call:
   - `fbq('track', 'CompleteRegistration')`
   - `trackEvent('sign_up', { method: 'email' | 'google' })` (Zaraz → GA4)
2. In **GA4 admin → Events**, mark `sign_up` as a Key Event.
3. In the **Cloudflare Zaraz dashboard**, add a Google Ads Conversion tool
   pointing at the same `sign_up` event with the new conversion label.
4. Repeat the pattern for any other funnel step you care about
   (`first_game_played`, etc.).

---

> **For a one-page summary suitable for sharing with the client, see
> [`ga4_vs_dashboard.md`](./ga4_vs_dashboard.md).**

## 4. In-house dashboard ↔ GA4 reconciliation

Dashboard entry point: `Client/src/pages/Admin/Home/Home.tsx`. Tile
definitions in `Client/src/pages/Admin/Home/StatsCard.tsx`. Server-side
aggregations in `Server/src/controllers/adminDashboardController.ts`.

### What the dashboard shows

| Tile                         | Source query                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Total Unique Visitors        | `COUNT(DISTINCT COALESCE(userId, sessionId))` over `gameId IS NOT NULL OR activityType = 'homepage_visit'` (lines 866-886) |
| Total Unique Players         | Same, but only `gameId IS NOT NULL` AND `duration >= 30` (lines 434-445)                                      |
| Daily Active Players         | Active users in the last 24h (lines 434-445 with rolling window)                                              |
| Best Performing Games        | Top 3 games by session count                                                                                  |
| Game Coverage                | % of total games played at least once                                                                         |
| Total Game Sessions          | Count of analytics rows where `gameId IS NOT NULL` AND `duration >= 30`                                       |
| Total Gameplay Time          | `SUM(endTime - startTime)` for qualifying sessions                                                            |
| Average Session Time         | Mean duration across qualifying sessions                                                                      |
| New Registered Users         | New users with `hasCompletedFirstLogin = true`                                                                |
| Retention Rate               | (yesterday's players who returned today) / (yesterday's players)                                              |
| Guest Sessions / Time Played | Same as the totals, restricted to `userId IS NULL`                                                            |
| Signup Button Clicks         | `SignupAnalytics` table (separate from main analytics)                                                        |

The dashboard hits `/api/admin/dashboard?period=X&country=Y&timezone=Z`
(`Server/src/controllers/adminDashboardController.ts:43-46`).

### Why GA4 numbers will not match

The `adminDashboardController.ts:864` comment says
_"Now includes both game sessions AND page visits to align with GA4"_ —
the team has consciously narrowed the gap. Concrete remaining differences:

| Concept              | In-house dashboard                                                                | GA4 (via Zaraz)                                  |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Environments        | All envs (api, api-staging, prod)                                                  | Production only (`arcadesbox.com` / `www.arcadesbox.com`) |
| Admin/staff exclusion | Yes — `superadmin/admin/editor/viewer` filtered (line 886)                       | No — sees all sessions                           |
| Bot filtering        | None                                                                              | Standard GA4 known-bot list                      |
| Session model        | One row per game session, `duration >= 30s` (line 440)                            | 30-min inactivity timeout, no duration floor     |
| Visitor identity     | `COALESCE(userId, sessionId)`; sessionId wiped on login                           | GA4 `client_id` cookie, persists across login    |
| Authenticated users  | Counted only after `hasCompletedFirstLogin = true` (line 883)                     | Counted from the first hit                       |
| Time window          | Rolling 24h, recomputed in user's timezone                                        | Calendar day in GA4 property's timezone          |
| Page visits          | BullMQ `homepage_visit` writes                                                    | Auto-collected `page_view` on every SPA route    |
| Loss vectors         | Redis/BullMQ outages drop writes                                                  | Ad blockers / privacy extensions drop ~15-25%    |

**Practical expectation**

- GA4 unique-visitor counts will tend to be **higher** than the dashboard:
  no admin exclusion, no `hasCompletedFirstLogin` gate, no 30-second floor.
- GA4 active-player counts will tend to be **lower** than the dashboard:
  ad blockers strip the GA4 collection request, while the in-house API is
  not on blocklists.
- They will not reconcile. Treat the in-house dashboard as the source of
  truth for product/billing metrics, and GA4 as directional for marketing
  and acquisition analysis.

---

## 5. Suggested follow-ups

1. **Decide whether ad conversions matter.** If yes, add the `sign_up` /
   `CompleteRegistration` events from §3 and verify in GA4 DebugView and
   Meta Events Manager.
2. **Register custom dimensions and metrics in GA4** for the gameplay event
   params, otherwise reports will only show event counts with no breakdowns.
3. **Document the Zaraz config out-of-band.** The GA4 measurement ID,
   triggers, and consent rules live only in Cloudflare and are invisible to
   anyone reading this repo.
4. **Add a regression test** that fails if `AdminExclusionService` is
   bypassed in any new write path — admin contamination is the most common
   way the dashboard drifts from reality.

---

## 6. Zaraz tool configuration

The end-to-end Cloudflare-dashboard runbook lives in a dedicated file —
it's long enough to warrant its own page and covers every event the app
emits, every trigger to create, every action on every tool, consent mode,
the GA4 DebugView gotcha, and a verification order.

**See [`zaraz_setup_runbook.md`](./zaraz_setup_runbook.md).**

Quick reminders that belong here rather than in the runbook:

- Zaraz config lives only in the Cloudflare dashboard. There is no
  `zaraz.json` / `wrangler.toml` in this repo — nothing to diff, nothing
  to review on PR.
- After any config change, verify in **Zaraz Monitoring** (dashboard
  live-stream) *and* **GA4 Realtime** before trusting it. GA4 DebugView
  is not fully reliable with Zaraz; see the runbook §7.
