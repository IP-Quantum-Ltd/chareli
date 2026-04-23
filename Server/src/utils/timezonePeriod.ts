import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface PeriodBoundaries {
  currentStart: Date;
  prevStart: Date;
  prevEnd: Date;
}

// Resolve today's calendar date as the user perceives it (e.g. "2026-04-24"
// for a Tokyo user at Apr 23 15:49 UTC because JST has already tipped into
// the next day). `toZonedTime` returns a Date whose UTC accessors reflect
// the target timezone's wall clock — safer than date-fns-tz's `format` with
// a `timeZone` option, which behaves inconsistently across v3 versions.
function todayDateInUserTz(nowUtc: Date, userTimezone: string): string {
  const zoned = toZonedTime(nowUtc, userTimezone);
  const year = zoned.getUTCFullYear();
  const month = String(zoned.getUTCMonth() + 1).padStart(2, '0');
  const day = String(zoned.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Previous implementation used setHours(0,0,0,0) which operates in the SERVER's
// local time (UTC on our ECS Fargate containers), silently discarding the
// timezone shift applied by toZonedTime. Every period on the admin dashboard
// became "since UTC midnight today" regardless of the timezone filter.
//
// Correct approach: (1) resolve today's calendar date as the user sees it,
// (2) interpret "midnight on that date" in the user's timezone, (3) convert
// back to a UTC instant. `currentStart` is the "today so far" boundary for
// daysBack=1, "six days before today's midnight" for daysBack=7, etc.
export function getPeriodBoundaries(
  nowUtc: Date,
  userTimezone: string,
  daysBack: number,
  prevDaysBack: number,
): PeriodBoundaries {
  const todayInUserTz = todayDateInUserTz(nowUtc, userTimezone);
  const startOfTodayUtc = fromZonedTime(`${todayInUserTz}T00:00:00`, userTimezone);

  const currentStart = new Date(startOfTodayUtc);
  currentStart.setUTCDate(currentStart.getUTCDate() - daysBack + 1);

  const prevStart = new Date(startOfTodayUtc);
  prevStart.setUTCDate(prevStart.getUTCDate() - prevDaysBack + 1);

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
