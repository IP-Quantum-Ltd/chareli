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
export function todayDateInUserTz(nowUtc: Date, userTimezone: string): string {
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

export interface BoundedPeriod extends PeriodBoundaries {
  currentEnd: Date;
}

// Calendar-day window for "today" in the user's timezone: start = today
// 00:00:00 user-tz, end = nowUtc (the moment the query was made). Comparison
// period is yesterday from 00:00 user-tz to the same elapsed time-of-day, so
// the previous window has the exact same duration as the current one. This
// gives apples-to-apples percentageChange and matches GA4 "Today" semantics.
//
// prevEnd is computed via elapsedMs (not nowUtc - 24h) so DST transitions in
// the user's timezone don't skew the window length: on the fall-back day the
// current window can be 23h or 25h wide depending on where nowUtc falls.
export function todayBoundaries(
  nowUtc: Date,
  userTimezone: string,
): BoundedPeriod {
  const today = todayDateInUserTz(nowUtc, userTimezone);
  const yesterday = calendarDateDaysBefore(today, 1);

  const currentStart = zonedMidnight(today, userTimezone);
  const currentEnd = nowUtc;
  const elapsedMs = currentEnd.getTime() - currentStart.getTime();
  const prevStart = zonedMidnight(yesterday, userTimezone);
  const prevEnd = new Date(prevStart.getTime() + elapsedMs);

  return { currentStart, currentEnd, prevStart, prevEnd };
}

// The user-tz calendar date of "yesterday" (YYYY-MM-DD). Stamping this on the
// dashboard cache key prevents a stale entry from before user-tz midnight from
// being served as the next day's "yesterday" data.
export function yesterdayDateInUserTz(nowUtc: Date, userTimezone: string): string {
  return calendarDateDaysBefore(todayDateInUserTz(nowUtc, userTimezone), 1);
}

// Calendar-day window for "yesterday" in the user's timezone: start = yesterday
// 00:00:00, end = yesterday 23:59:59.999. Comparison period is the day before
// (a 1-day window immediately preceding), matching the shape of last7days /
// last30days so the dashboard's percentageChange calculation works unchanged.
export function yesterdayBoundaries(
  nowUtc: Date,
  userTimezone: string,
): BoundedPeriod {
  const today = todayDateInUserTz(nowUtc, userTimezone);
  const yesterday = calendarDateDaysBefore(today, 1);
  const dayBefore = calendarDateDaysBefore(today, 2);

  const currentStart = zonedMidnight(yesterday, userTimezone);
  const currentEnd = parseCustomDayBoundary(yesterday, userTimezone, 'end');
  const prevStart = zonedMidnight(dayBefore, userTimezone);

  return {
    currentStart,
    currentEnd,
    prevStart,
    prevEnd: currentStart,
  };
}
