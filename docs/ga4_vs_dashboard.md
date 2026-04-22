# GA4 vs. the in-house admin dashboard: why the numbers won't match

_A plain-English summary for stakeholders. For the engineering detail,
see [`analytics_audit.md`](./analytics_audit.md) §4._

## What each tool measures

- **GA4 (via Cloudflare Zaraz → Google Analytics 4)** — tells us how
  marketing campaigns and acquisition channels are performing. It is the
  industry-standard view Google Ads, Meta Ads, and attribution tools
  expect. It is always an *undercount* because ad blockers, privacy
  extensions, and consent-declining users drop out.
- **Admin dashboard (in-house)** — tells us what is actually happening
  inside the product: gameplay sessions, signups that completed, retention
  cohorts, billing-relevant activity. It records first-party data the
  browser sends to our own API, which ad blockers don't target.

The two tools are built for different decisions. Treating them as the
same measurement and asking them to agree will always produce friction.

## Why the numbers diverge

The dashboard filters and GA4 filters cut data in different ways. The
eight concrete causes, in rough order of impact:

1. **Ad blockers and privacy settings** — GA4 loses roughly 15-25% of
   users (higher on a gaming audience, which skews toward blocker
   adoption). The in-house API is not on blocker lists.
2. **Admin and staff exclusion** — the dashboard filters out sessions
   from anyone on the internal team (superadmin, admin, editor, viewer).
   GA4 sees every session, including ours.
3. **Environment gating** — GA4 only runs on the two production
   hostnames (`arcadesbox.com`, `www.arcadesbox.com`). Dev and staging
   traffic still appears in the dashboard but is invisible to GA4.
4. **Bot filtering** — GA4 removes traffic from its known-bot list. The
   dashboard has no bot filter at the moment, so aggressive crawlers can
   inflate its totals.
5. **Session-length floor** — the dashboard counts a "game session" only
   when it's at least 30 seconds long. GA4 has no such floor; any
   `game_start` event counts.
6. **Consent banner** — users who decline the cookie banner are excluded
   from GA4. The in-house analytics are first-party and run regardless of
   the banner (within the limits of the privacy policy).
7. **Identity and login** — the dashboard ties activity to `userId` for
   logged-in users and a fresh `sessionId` for anonymous ones (wiped on
   login to prevent admin contamination). GA4 uses its own `client_id`
   cookie that persists across login and across devices with the same
   cookie store.
8. **Counting windows** — the dashboard uses a rolling 24-hour window in
   the user's timezone; GA4 uses calendar days in the GA4 property's
   timezone. "Today" looks different in the two tools.

## Which tool to use when

| Question                                                | Use GA4 | Use the dashboard |
| ------------------------------------------------------- | :-----: | :---------------: |
| Which ad campaign drove the most signups?               |    ✔    |                   |
| What's our CPA on Google Ads?                           |    ✔    |                   |
| How many people are actually logged in right now?       |         |         ✔         |
| How long is the average gameplay session?               |         |         ✔         |
| Did revenue hold in this cohort?                        |         |         ✔         |
| Is our Meta audience targeting the right demographic?   |    ✔    |                   |
| Is the launch of Feature X moving retention?            |         |         ✔         |

Rule of thumb: **marketing and attribution questions → GA4. Product,
billing, and retention questions → dashboard.**

## Could we make them match more closely?

The single biggest lever is **server-side GA4 via the Measurement
Protocol**: forward first-party events we already record from our server
directly to GA4, bypassing the browser and its blockers entirely. This
would eliminate the ad-blocker gap (cause #1 above), which is the largest
driver of divergence on our audience.

This is a scoped follow-up project, not a quick config change. Until it
ships, the two numbers will continue to diverge and that is expected.

## What we've done to narrow the gap in the meantime

- The admin dashboard now counts both game sessions *and* page visits,
  so its visitor count is closer to GA4's `users` metric.
  (`adminDashboardController.ts:864` — comment: _"Now includes both game
  sessions AND page visits to align with GA4"_).
- Ad conversion events (`sign_up`, `game_start`) are now emitted from
  app code and wired through Zaraz so Google Ads can record them —
  previously the tag only tracked Pageviews.
- GA4 DebugView is enabled so anyone on the team can watch events arrive
  in real time without extra configuration.

## Summary

- GA4 and the dashboard will never match. They shouldn't.
- GA4 = marketing truth (imperfect coverage, industry-standard).
- Dashboard = product truth (complete within the app, not visible to
  advertisers).
- If you need reconciled numbers for a specific decision, tell us the
  decision and we'll pick the right tool or cross-reference both.
