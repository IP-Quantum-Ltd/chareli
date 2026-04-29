// Standalone smoke check for the timezone-period helper.
// Run with: cd Server && npx ts-node src/utils/__tests__/timezonePeriod.smoke.ts
//
// This is NOT a jest test — it's a human-readable verification script that
// prints scenarios in a table so you can eyeball correctness. The previous
// implementation silently returned UTC-midnight boundaries regardless of the
// timezone parameter; this script proves the new impl honors the timezone.

import {
  getPeriodBoundaries,
  parseCustomDayBoundary,
} from '../timezonePeriod';

const fmt = (d: Date) => d.toISOString();

interface Scenario {
  label: string;
  nowUtc: string;
  tz: string;
  daysBack: number;
  expectCurrentStart: string;
  expectPrevStart?: string;
}

const scenarios: Scenario[] = [
  // User's actual situation when the bug was observed.
  {
    label: 'Nicosia user, 18:49 EEST (our screenshot)',
    nowUtc: '2026-04-23T15:49:00Z',
    tz: 'Europe/Nicosia',
    daysBack: 1,
    expectCurrentStart: '2026-04-22T21:00:00.000Z', // Apr 23 00:00 EEST (UTC+3)
  },
  // Baseline: UTC user on the same instant.
  {
    label: 'UTC user, 15:49 UTC',
    nowUtc: '2026-04-23T15:49:00Z',
    tz: 'UTC',
    daysBack: 1,
    expectCurrentStart: '2026-04-23T00:00:00.000Z',
  },
  // Timezone ahead of UTC where the wall-clock day has already advanced.
  {
    label: 'Tokyo user, 00:49 JST on Apr 24 (UTC still Apr 23 15:49)',
    nowUtc: '2026-04-23T15:49:00Z',
    tz: 'Asia/Tokyo',
    daysBack: 1,
    expectCurrentStart: '2026-04-23T15:00:00.000Z', // Apr 24 00:00 JST (UTC+9)
  },
  // Timezone behind UTC.
  {
    label: 'New York user, 11:49 EDT',
    nowUtc: '2026-04-23T15:49:00Z',
    tz: 'America/New_York',
    daysBack: 1,
    expectCurrentStart: '2026-04-23T04:00:00.000Z', // Apr 23 00:00 EDT (UTC-4)
  },
  // 7-day window for the Nicosia user — must anchor on zoned midnight.
  {
    label: 'Nicosia user, last 7 days',
    nowUtc: '2026-04-23T15:49:00Z',
    tz: 'Europe/Nicosia',
    daysBack: 7,
    expectCurrentStart: '2026-04-16T21:00:00.000Z', // 6 days before Apr 22 21:00 UTC
  },
  // DST edge: Nicosia transitions to EEST at 2026-03-29 01:00 UTC (03:00 local → 04:00).
  // Before DST (Mar 28, UTC+2) vs after DST (Mar 30, UTC+3).
  {
    label: 'Nicosia user on Mar 28 (pre-DST, UTC+2)',
    nowUtc: '2026-03-28T12:00:00Z',
    tz: 'Europe/Nicosia',
    daysBack: 1,
    expectCurrentStart: '2026-03-27T22:00:00.000Z', // 00:00 EET
  },
  {
    label: 'Nicosia user on Mar 30 (post-DST, UTC+3)',
    nowUtc: '2026-03-30T12:00:00Z',
    tz: 'Europe/Nicosia',
    daysBack: 1,
    expectCurrentStart: '2026-03-29T21:00:00.000Z', // 00:00 EEST
    // prevStart = Mar 29 00:00 Nicosia wall clock. Mar 29 00:00 is BEFORE
    // EU DST cutover (01:00 UTC that day), so it's EET/UTC+2 not EEST/UTC+3.
    // Correct UTC: 2026-03-28T22:00:00.000Z, NOT 2026-03-28T21:00:00.000Z.
    expectPrevStart: '2026-03-28T22:00:00.000Z',
  },
  // Year boundary — Dec 31 -> Jan 1 in a UTC-ahead zone.
  {
    label: 'Tokyo user just after midnight Jan 1 2027',
    nowUtc: '2026-12-31T15:30:00Z',
    tz: 'Asia/Tokyo',
    daysBack: 1,
    expectCurrentStart: '2026-12-31T15:00:00.000Z', // Jan 1 2027 00:00 JST
  },

  // ── DST-crossing arithmetic ─────────────────────────────────────────────
  // These scenarios were the reason an earlier revision of this helper was
  // subtly wrong: walking N UTC days back from today's zoned-midnight-as-
  // UTC-instant silently drifts by an hour when the window crosses a DST
  // transition in the user's timezone.

  // US fall-back — "last 7 days" on Nov 5 crosses Nov 1 02:00 local (EDT→EST).
  // Oct 30 is still in EDT (UTC-4). Broken impl would return 05:00Z (= 01:00
  // EDT on Oct 30). Correct is 04:00Z (= 00:00 EDT).
  {
    label: 'NY user, last 7 days on Nov 5 2026 (crosses fall-back)',
    nowUtc: '2026-11-05T13:00:00Z',
    tz: 'America/New_York',
    daysBack: 7,
    expectCurrentStart: '2026-10-30T04:00:00.000Z',
  },
  // US spring-forward — "last 7 days" on Mar 12 crosses Mar 8 02:00 local
  // (EST→EDT). Mar 6 is still in EST (UTC-5). Broken impl drifts by 1h.
  {
    label: 'NY user, last 7 days on Mar 12 2026 (crosses spring-forward)',
    nowUtc: '2026-03-12T13:00:00Z',
    tz: 'America/New_York',
    daysBack: 7,
    expectCurrentStart: '2026-03-06T05:00:00.000Z',
  },
  // EU spring-forward — "last 7 days" on Mar 30 for Nicosia crosses Mar 29
  // 01:00 UTC (EET→EEST). Mar 24 is still in EET (UTC+2). Broken impl drifts.
  {
    label: 'Nicosia user, last 7 days on Mar 30 2026 (crosses EU DST)',
    nowUtc: '2026-03-30T12:00:00Z',
    tz: 'Europe/Nicosia',
    daysBack: 7,
    expectCurrentStart: '2026-03-23T22:00:00.000Z',
  },
];

let failures = 0;

console.log('='.repeat(100));
console.log('getPeriodBoundaries — scenario checks');
console.log('='.repeat(100));
for (const s of scenarios) {
  const { currentStart, prevStart, prevEnd } = getPeriodBoundaries(
    new Date(s.nowUtc),
    s.tz,
    s.daysBack,
    s.daysBack * 2,
  );
  const currentOk = fmt(currentStart) === s.expectCurrentStart;
  const prevOk = s.expectPrevStart ? fmt(prevStart) === s.expectPrevStart : true;
  const ok = currentOk && prevOk;
  const marker = ok ? 'OK ' : 'FAIL';
  console.log(`${marker}  ${s.label}`);
  console.log(`      now UTC       = ${s.nowUtc}`);
  console.log(`      timezone      = ${s.tz}, daysBack = ${s.daysBack}`);
  console.log(`      currentStart  = ${fmt(currentStart)}`);
  console.log(`      expected      = ${s.expectCurrentStart}`);
  console.log(`      prevStart     = ${fmt(prevStart)}`);
  if (s.expectPrevStart) {
    console.log(`      expected prev = ${s.expectPrevStart}`);
  }
  console.log(`      prevEnd       = ${fmt(prevEnd)}`);
  if (!ok) failures++;
  console.log('');
}

// Custom-range boundary parser.
console.log('='.repeat(100));
console.log('parseCustomDayBoundary — calendar-day interpretation in user tz');
console.log('='.repeat(100));

const customCases = [
  {
    input: '2026-04-20',
    tz: 'Europe/Nicosia',
    start: '2026-04-19T21:00:00.000Z', // Apr 20 00:00 EEST (UTC+3)
    end:   '2026-04-20T20:59:59.999Z', // Apr 20 23:59:59.999 EEST
  },
  {
    input: '2026-04-20',
    tz: 'UTC',
    start: '2026-04-20T00:00:00.000Z',
    end:   '2026-04-20T23:59:59.999Z',
  },
  {
    input: '2026-04-20',
    tz: 'America/New_York',
    start: '2026-04-20T04:00:00.000Z', // EDT = UTC-4
    end:   '2026-04-21T03:59:59.999Z',
  },
  {
    // Defensive: user supplies a full datetime; we should strip the time.
    input: '2026-04-20T15:00:00Z',
    tz: 'Europe/Nicosia',
    start: '2026-04-19T21:00:00.000Z',
    end:   '2026-04-20T20:59:59.999Z',
  },
];

for (const c of customCases) {
  const startActual = parseCustomDayBoundary(c.input, c.tz, 'start');
  const endActual = parseCustomDayBoundary(c.input, c.tz, 'end');
  const startOk = fmt(startActual) === c.start;
  const endOk = fmt(endActual) === c.end;
  const marker = startOk && endOk ? 'OK ' : 'FAIL';
  console.log(`${marker}  input="${c.input}" tz=${c.tz}`);
  console.log(`      start  got=${fmt(startActual)}  want=${c.start}`);
  console.log(`      end    got=${fmt(endActual)}  want=${c.end}`);
  if (!startOk || !endOk) failures++;
  console.log('');
}

console.log('='.repeat(100));
if (failures === 0) {
  console.log(`ALL SCENARIOS PASSED`);
} else {
  console.log(`${failures} SCENARIO(S) FAILED`);
  process.exit(1);
}
