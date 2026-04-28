import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface PeriodBoundaries {
  currentStart: Date;
  prevStart: Date;
  prevEnd: Date;
}

function isoDateFromUtcContainer(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Resolve today's calendar date as the user perceives it (e.g. "2026-04-24"
// for a Tokyo user at Apr 23 15:49 UTC because JST has already tipped into
// the next day). Uses toZonedTime + UTC accessors; date-fns-tz's `format`
// with a `timeZone` option behaves inconsistently across v3 versions.
function todayDateInUserTz(nowUtc: Date, userTimezone: string): string {
  return isoDateFromUtcContainer(toZonedTime(nowUtc, userTimezone));
}

// Walk `daysBefore` calendar days back from `dateStr` (a YYYY-MM-DD string in
// the user's timezone). Returns a new YYYY-MM-DD string.
//
// Arithmetic happens on the calendar date itself via a UTC-container Date.
// This is deliberate: every UTC day is exactly 24h, so setUTCDate-based
// subtraction walks calendar days cleanly. Resolving the string back to a
// UTC instant via fromZonedTime happens once at the END, so DST transitions
// in the user's timezone just shift the offset of the resulting instant
// instead of bleeding an hour into the boundary.
function calendarDateDaysBefore(dateStr: string, daysBefore: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCDate(anchor.getUTCDate() - daysBefore);
  return isoDateFromUtcContainer(anchor);
}

function zonedMidnight(dateStr: string, userTimezone: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00`, userTimezone);
}

// Previous implementation used setHours(0,0,0,0) which operates in server-
// local time (UTC on our ECS Fargate containers), silently discarding the
// timezone shift applied by toZonedTime. Every period on the admin dashboard
// became "since UTC midnight today" regardless of the timezone filter.
//
// An earlier revision of this fix anchored on "today's user-tz midnight" as
// a UTC instant and then subtracted UTC days. That was still subtly wrong:
// UTC-day arithmetic silently drifts an hour on weeks that cross a DST
// transition in the user's timezone (e.g. NY "last 7 days" on Nov 5, after
// fall-back: the boundary for Oct 30 would land at 05:00 UTC / 01:00 EDT
// instead of 04:00 UTC / 00:00 EDT).
//
// Correct approach: (1) resolve today's calendar date as the user sees it,
// (2) walk the calendar DATE by integer days, (3) only then interpret
// "midnight on that date" in the user's timezone to get a UTC instant.
// Every boundary lands on a true user-timezone midnight regardless of DST.
export function getPeriodBoundaries(
  nowUtc: Date,
  userTimezone: string,
  daysBack: number,
  prevDaysBack: number,
): PeriodBoundaries {
  const today = todayDateInUserTz(nowUtc, userTimezone);
  const currentStartDate = calendarDateDaysBefore(today, daysBack - 1);
  const prevStartDate = calendarDateDaysBefore(today, prevDaysBack - 1);

  const currentStart = zonedMidnight(currentStartDate, userTimezone);
  const prevStart = zonedMidnight(prevStartDate, userTimezone);
  const prevEnd = new Date(currentStart);

  return { currentStart, prevStart, prevEnd };
}

// Rolling 24h window ending at `nowUtc`. Timezone-independent: the dashboard's
// "Last 24 hours" filter means a true rolling window matching GA4 semantics,
// not "since user-tz midnight today." Calendar-day anchoring lives in
// getPeriodBoundaries and applies to longer periods (7d, 30d, custom).
export function rollingDayBoundaries(nowUtc: Date): PeriodBoundaries {
  const ms24h = 24 * 60 * 60 * 1000;
  const currentStart = new Date(nowUtc.getTime() - ms24h);
  const prevStart = new Date(nowUtc.getTime() - 2 * ms24h);
  return { currentStart, prevStart, prevEnd: currentStart };
}

// Interpret user-supplied start/end dates as calendar days in the user's
// timezone rather than UTC. A Nicosia user picking "2026-04-20" as start
// means "Apr 20 00:00 in Nicosia" (= 2026-04-19T21:00Z), not UTC midnight.
export function parseCustomDayBoundary(
  dateStr: string,
  userTimezone: string,
  which: 'start' | 'end',
): Date {
  const dateOnly = dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
  const time = which === 'start' ? '00:00:00' : '23:59:59.999';
  return fromZonedTime(`${dateOnly}T${time}`, userTimezone);
}
