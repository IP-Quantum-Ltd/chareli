# Zaraz setup runbook: GA4 and Google Ads

_End-to-end walkthrough for configuring the Cloudflare Zaraz dashboard so
every analytics event emitted by the client app reaches the right tool.
Pairs with [`analytics_audit.md`](./analytics_audit.md) (the inventory)
and [`ga4_vs_dashboard.md`](./ga4_vs_dashboard.md) (the client-facing
explanation of reconciliation)._

> **Anchor model:** Zaraz has three moving parts.
>
> - **Events** — what the browser sends via `zaraz.track(name, props)`.
> - **Triggers** — named match rules; most commonly "Event Name equals X".
> - **Actions** — "do X on tool Y when trigger Z fires." An action pulls
>   event properties via `{{ client.propertyName }}`.
>
> One trigger per unique event name. Each tool that cares about the event
> gets its own action sharing that trigger.

---

## 1. Event inventory

Every event the client app sends, verified by `rg` across `Client/src`.

| Event | Emit site | Properties | When it fires | Conversion candidate? |
| --- | --- | --- | --- | :---: |
| `game_start` | `Client/src/pages/GamePlay/GamePlay.tsx:275` | `game_id`, `game_title`, `event_category`, `event_label` | Game session begins | ✅ |
| `game_end` | `GamePlay.tsx:371` | + `duration` | Normal end of session | ❌ diagnostic |
| `game_milestone` | `GamePlay.tsx:306` | + `milestone`, `duration` | 30s / 1min / 5min checkpoints | 🟡 optional, deep engagement |
| `game_loaded` | `GamePlay.tsx:557` | + `load_time` | Iframe finished loading | ❌ perf diagnostic |
| `game_exit` | `GamePlay.tsx:375, 434` | + `duration`, `reason` | Early exit | ❌ diagnostic |
| `game_share` | `GameInfoSection.tsx:51, 57, 163, 178` | + `share_method` (`web_share` / `clipboard` / `whatsapp` / `facebook`) | User shares a game | 🟡 optional, referral signal |
| `see_more_games` | `AllGamesSection.tsx:160` | `page`, `category`, `total_games_loaded` | "See More" paginate | ❌ micro-engagement |
| `back_to_top_all_games` | `AllGamesSection.tsx:177` | `category`, `total_games_loaded` | "Back to top" | ❌ |
| `game_click` | `Client/src/hooks/useGameClickHandler.ts:65` (direct `zaraz.track`) | `game_id`, `game_slug`, `source` | User clicks a game tile, before nav | ✅ top of funnel |
| `sign_up` | `Client/src/components/modals/SignUpModal.tsx:227`, `Client/src/pages/RegisterInvitation/RegisterForm.tsx:75` | `method` (`email` / `invitation`) | Account persisted server-side | ✅ primary conversion |

Pure automatic pageviews also flow:
- **Meta Pixel** — `fbq('track', 'PageView')` on every SPA route change (`Client/src/layout/RootLayout.tsx:74`) and on init (`Client/src/analytics.ts:52`).
- **GA4** — handled automatically by Zaraz's GA4 tool. No code emit.

**Small consistency gotcha:** `game_click` calls `window.zaraz.track` directly rather than going through the `trackEvent` helper in `Client/src/utils/analytics.ts`, so it skips the `isAnalyticsEnabled()` check (which requires both `shouldLoadAnalytics === true` and `zaraz` defined; the direct call only checks `zaraz`). Low-impact because `zaraz` isn't loaded outside production anyway, but worth migrating to the helper next time that file is touched.

---

## 2. Triggers to create

Cloudflare dashboard → **Zaraz** → **Triggers** → **Create trigger**.

Create one trigger per event name. Variable name is always **Event Name**, match operation is always **Equals**.

| Trigger name | Match string |
| --- | --- |
| Event: game_start | `game_start` |
| Event: game_end | `game_end` |
| Event: game_milestone | `game_milestone` |
| Event: game_loaded | `game_loaded` |
| Event: game_exit | `game_exit` |
| Event: game_share | `game_share` |
| Event: see_more_games | `see_more_games` |
| Event: back_to_top | `back_to_top_all_games` |
| Event: game_click | `game_click` |
| Event: sign_up | `sign_up` |

Skip any you won't wire up yet — triggers are cheap to add later.

Don't recreate the default `Pageview`, `Pageload`, `Client Ready` triggers; they already exist and are used by each tool's Automated actions.

---

## 3. GA4 tool configuration

Goal: every custom event reaches GA4 with its properties intact.

**Zaraz → Tools → Google Analytics 4 → Settings:**

- **Measurement ID**: `G-XXXXXXXXXX` — pull from GA4 admin → Data Streams → Web stream. Do not check into the repo.
- **Default event fields** (apply to every event GA4 sees):
  - `debug_mode` = `true` — see §7 for the caveat.
  - `send_page_view` = `true` if you want GA4 to keep auto-collecting pageviews (default behavior).

**Zaraz → Tools → Google Analytics 4 → Custom actions → Create action.**

Create one action per event you want in GA4. Template per event:

| Field | Value |
| --- | --- |
| Action name | e.g. `GA4 — game_start` |
| Action type | **Event** (not Pageview) |
| Firing triggers | The matching trigger from §2 |
| Event name | The literal event name (`game_start`, `sign_up`, etc.) |

**Event parameters** — add one row per property the code sends. Names must match exactly.

For `game_start`, `game_end`, `game_milestone`, `game_loaded`, `game_exit`:

| Parameter | Value |
| --- | --- |
| `game_id` | `{{ client.game_id }}` |
| `game_title` | `{{ client.game_title }}` |
| `event_category` | `{{ client.event_category }}` |
| `event_label` | `{{ client.event_label }}` |
| `duration` _(end/milestone/exit)_ | `{{ client.duration }}` |
| `milestone` _(milestone only)_ | `{{ client.milestone }}` |
| `load_time` _(loaded only)_ | `{{ client.load_time }}` |
| `reason` _(exit only)_ | `{{ client.reason }}` |

For `game_share`: above plus `share_method` = `{{ client.share_method }}`.
For `see_more_games` / `back_to_top_all_games`: `page`, `category`, `total_games_loaded`.
For `game_click`: `game_id`, `game_slug`, `source`.
For `sign_up`: `method` = `{{ client.method }}`.

**Faster option:** each GA4 custom action has an **"Include event properties"** toggle — enable it and all properties forward without per-field mapping. Tradeoff: any new property in code will silently flow through, which can surprise you in reports. Pick one approach and stay consistent.

**Final GA4 admin step** — mark as Key Events (required for GA4→Ads auto-import and for them to show in the Conversions column of GA4 reports):

- GA4 admin → Events → toggle **Mark as key event** on `sign_up`, `game_click`, `game_start`.

---

## 4. Google Ads Conversion tool configuration

This is the tool that currently has zero custom actions — the root cause of "ad conversions aren't firing." The conversion ID is already set.

**Zaraz → Tools → Google Ads Conversion Tracking → Settings:**

- **Conversion ID**: `AW-17063551057` — already configured.
- No other settings to change at the tool level.

**Before creating actions, pull conversion labels from the Google Ads console.** This is the tedious bit — there's no way to see labels from Zaraz side.

- Google Ads → **Goals** → **Conversions** → click the conversion action (one per: Signup, Game click, Game start, optionally Game milestone) → **Tag setup** → **Install the tag yourself**.
- The label is the string after the `/` in `AW-17063551057/XXXXXXXXXX`. Copy just `XXXXXXXXXX`.
- If a conversion action doesn't exist yet, create it first in Google Ads with the appropriate category (Sign-up, Page view, Custom, etc.).

**Zaraz → Tools → Google Ads Conversion Tracking → Custom actions → Create action** — one per conversion.

| Field | `sign_up` | `game_click` | `game_start` | `game_milestone` (optional) |
| --- | --- | --- | --- | --- |
| Action name | Signup conversion | Game click conversion | Game start conversion | Game milestone conversion |
| Action type | **Conversion Event** | Conversion Event | Conversion Event | Conversion Event |
| Firing triggers | `Event: sign_up` | `Event: game_click` | `Event: game_start` | `Event: game_milestone` |
| Conversion label | label from Ads | label from Ads | label from Ads | label from Ads |
| Value | _(empty — no monetary value)_ | _(empty)_ | _(empty)_ | _(empty)_ |
| Currency | `USD` or leave empty | same | same | same |
| Transaction ID | _(empty — not e-commerce)_ | _(empty)_ | _(empty)_ | _(empty)_ |

**Optional — segment signups in Ads by source.** Add a custom field on the Signup action: `method` = `{{ client.method }}`. Lets Ads split email vs invitation signups in reports.

**Enhanced conversions — deferred.** They require hashing the user's email / phone SHA-256 client-side before emission in a `user_data` object. Not implemented today. Follow-up item if match rates become a priority.

---

## 5. Consent Mode v2

Google Ads silently drops everything if `ad_storage` is denied. Zaraz has Consent Mode v2 built in but it's opt-in.

**Zaraz → Settings → "Set Google Consent Mode v2 state":**

- Tick the box to enable.
- **Defaults** (apply before user interaction):
  - `ad_storage`: `denied`
  - `ad_user_data`: `denied`
  - `ad_personalization`: `denied`
  - `analytics_storage`: `denied`
- In GDPR regions, keep defaults denied and rely on the banner's accept handler.
- Outside GDPR jurisdictions, `granted` defaults are acceptable — but that's a legal/compliance call, not a technical one. **Do not flip defaults without explicit sign-off.**

**If you use Zaraz's built-in CMP:** the consent banner handles the update to `granted` automatically when the user accepts.

**If you have a custom cookie banner:** wire the accept handler to call:

```js
window.zaraz?.consent?.set({
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted',
});
```

Verify in Chrome DevTools → Application → Cookies. Zaraz names the consent cookie based on your config (commonly `cf_consent` or similar). Toggle accept/decline and confirm the cookie reflects the choice.

---

## 6. Meta Pixel (unrelated to Zaraz — lives in code)

The Meta Pixel is loaded directly from `Client/src/analytics.ts`, not through Zaraz. No console work required. `trackConversion.signUp(method)` in `Client/src/utils/analytics.ts` fires `fbq('track', 'CompleteRegistration', { method })` alongside the Zaraz `sign_up` event.

Verify in **Meta Events Manager → Test Events**:

1. In Events Manager, open **Test Events**, copy the test event browser code.
2. Paste it into a URL parameter (e.g. `?fbclid=...&test_event_code=TEST123`) when visiting the production site in a fresh incognito window, or set it via the Meta Events Manager's browser extension helper.
3. Complete signup.
4. `PageView` + `CompleteRegistration` should appear in the Test Events stream within a few seconds.

---

## 7. The GA4 DebugView gotcha

**Plain truth: GA4 DebugView does not fully work with Zaraz the way it works with gtag/GTM.**

Zaraz is a server-side tag manager — events go browser → Cloudflare → GA4 Measurement Protocol, not browser → GA4 directly. GA4 DebugView was built assuming the browser-direct path, so some events flag as debug and others don't, inconsistently. Setting `debug_mode: true` on the GA4 tool *helps* but doesn't guarantee DebugView coverage.

### What actually works for troubleshooting

1. **Zaraz Monitoring** (Cloudflare dashboard → Zaraz → Monitoring) — live stream of every event hitting your Zaraz config, grouped by tool and action. **This is the Zaraz-native equivalent of DebugView and it works 100% of the time.**
2. **Zaraz debug mode** — in the browser console on the production site, run:
   ```js
   zaraz.debug("YOUR_DEBUG_KEY");  // key from Cloudflare → Zaraz → Settings → Debug Key
   ```
   Creates a `zarazDebug` cookie and pops up a debug panel in the browser showing events, trigger matches, tool actions, and evaluated variables in real time. Disable with `zaraz.debug()` (no args).
3. **GA4 Realtime report** (GA4 admin → Realtime) — shows events as they arrive. Uses a different ingestion path than DebugView and works reliably with Zaraz. Less detailed than DebugView but proves the pipe is live and events are reaching the GA4 property.

### Recommendation

- Keep `debug_mode: true` on the GA4 tool — it's cheap, and occasionally it does land events in DebugView.
- For reliable day-to-day troubleshooting, the team should use **Zaraz Monitoring** and **GA4 Realtime**, not DebugView.
- If DebugView specifically is a hard requirement (training / agency SLA), the only workaround is running gtag.js in parallel with Zaraz — which defeats the migration. Don't do that without a very good reason.

This is a [documented Cloudflare limitation](https://community.cloudflare.com/t/ga4-with-gtag-js-in-order-to-debug/600518), not something we can fix from our side.

---

## 8. Verification order

After configuring everything above, in this order:

1. Publish all trigger and action changes in Zaraz.
2. Fresh incognito → `https://arcadesbox.com`.
3. **Full funnel:** land on home → click any game tile → play for >30 seconds → go through signup (email path) → sign out → redo signup via an invitation link (second path).
4. **Zaraz Monitoring** (dashboard): confirm `game_click`, `game_start`, `game_milestone` (if configured), `sign_up` events appear with the right trigger matches and tool actions firing.
5. **Zaraz debug mode** (browser console, `zaraz.debug("...")` ): confirm event properties are being resolved correctly (`{{ client.game_id }}` shows the actual ID, not an empty string).
6. **GA4 Realtime** (GA4 admin → Realtime): events appear within ~30s with correct properties.
7. **GA4 DebugView**: check, but don't be alarmed if coverage is spotty — §7.
8. **Meta Events Manager → Test Events**: `PageView` + `CompleteRegistration` arrive.
9. **Google Ads → Goals → Conversions**: status flips from "No recent conversions" to "Recording conversions" within ~3 hours. This is the only step with latency — Ads batches.
10. In GA4 admin → Events, confirm `sign_up`, `game_click`, `game_start` are toggled as **Key Events**.

---

## 9. Troubleshooting cheat sheet

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| `sign_up` event in Zaraz Monitoring but not in GA4 Realtime | GA4 custom action missing or misconfigured | Zaraz → GA4 → Custom actions |
| Event in GA4 Realtime but not in Ads | Google Ads Custom action missing, wrong conversion label, or `ad_storage` denied | Zaraz → Google Ads → Custom actions; check Consent cookie in DevTools |
| Event in Zaraz Monitoring without property values (e.g. `game_id` blank) | `{{ client.X }}` reference doesn't match the property name emitted by code | Cross-check action field mapping against the inventory in §1 |
| Nothing appearing in Zaraz Monitoring at all | `zaraz.track` not firing (check `isAnalyticsEnabled()` in `Client/src/utils/analytics.ts`), or the trigger isn't matching | Zaraz debug mode in browser console |
| `PageView` firing but `CompleteRegistration` not in Meta | `fbq` defined check failed at runtime, or Meta Pixel not yet initialized (2s delay) | Test with >2s delay after page load |
| Google Ads shows "No recent conversions" 24h+ after configuration | Conversion label wrong, or `ad_storage` still denied for all real traffic | Pull the label fresh from Ads → Conversions → Tag setup; check consent banner behavior in production |

---

## 10. Out of scope (follow-ups)

- **Enhanced conversions for Google Ads** — requires SHA-256 hashing email/phone client-side into a `user_data` object before `zaraz.track`. Bumps Ads match rates materially. See the [community gist](https://gist.github.com/it-can/188acc89637160d21ab9a37e1bbf0b2c) for a reference implementation.
- **Server-side GA4 (Measurement Protocol)** — forward first-party events from our server to GA4 directly, bypassing browser blockers. Biggest lever for narrowing the GA4↔dashboard gap; see [`ga4_vs_dashboard.md`](./ga4_vs_dashboard.md).
- **Additional ad pixels** (TikTok, Reddit, LinkedIn, Bing UET, Pinterest). Each is a separate Zaraz tool + its own custom actions.
- **Migrate `game_click` emit** in `Client/src/hooks/useGameClickHandler.ts:65` to use the shared `trackEvent` helper so it picks up the `isAnalyticsEnabled()` gate.
- **Custom dimensions / metrics in GA4** for numeric event params (`duration`, `load_time`, `total_games_loaded`) so they appear in reports as aggregations, not just event counts.

---

## Sources

- [zaraz.track · Cloudflare docs](https://developers.cloudflare.com/zaraz/web-api/track/)
- [Create a trigger · Cloudflare docs](https://developers.cloudflare.com/zaraz/custom-actions/create-trigger/)
- [Create an action · Cloudflare docs](https://developers.cloudflare.com/zaraz/custom-actions/create-action/)
- [Debug mode · Cloudflare docs](https://developers.cloudflare.com/zaraz/web-api/debug-mode/)
- [Google Consent Mode v2 with Zaraz · Cloudflare docs](https://developers.cloudflare.com/zaraz/advanced/google-consent-mode/)
- [Zaraz FAQ · Cloudflare docs](https://developers.cloudflare.com/zaraz/faq/)
- [Enhanced conversions with Zaraz — community reference gist](https://gist.github.com/it-can/188acc89637160d21ab9a37e1bbf0b2c)
- [GA4 DebugView limitation with Zaraz — community thread](https://community.cloudflare.com/t/ga4-with-gtag-js-in-order-to-debug/600518)
