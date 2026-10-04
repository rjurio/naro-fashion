/**
 * East Africa Time (Africa/Dar_es_Salaam) date helpers.
 *
 * The VPS runs in UTC but the business day is EAT = UTC+3 with NO daylight
 * saving, so a fixed offset is exact. Using server-local `setHours(0,0,0,0)` /
 * `new Date(y, m, 1)` put the day/month boundary at 03:00 EAT — sales made
 * between 00:00 and 03:00 EAT landed in the previous day/month, and expenses
 * dated on the 1st could fall into the wrong financial period.
 *
 * Every day/month boundary in POS, reports, expenses and rentals goes through
 * these helpers. Pure functions, no dependencies (safe to import anywhere in
 * the API — do NOT import @naro/shared here, see CLAUDE.md).
 */

export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar parts (year, 0-based month, day) of an instant as seen in EAT. */
export function eatParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + EAT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** UTC instant of 00:00 EAT on the given EAT calendar date (0-based month). */
export function eatMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - EAT_OFFSET_MS);
}

/**
 * Start/end instants of an EAT calendar day.
 *  - `'YYYY-MM-DD'` strings are interpreted as an EAT calendar date (NOT UTC).
 *  - Date / other strings: the EAT calendar day containing that instant.
 *  - undefined: today in EAT.
 */
export function eatDayBounds(input?: string | Date): { start: Date; end: Date; dateKey: string } {
  let year: number;
  let month: number;
  let day: number;
  const m = typeof input === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) : null;
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
    day = Number(m[3]);
  } else {
    const d = input === undefined ? new Date() : new Date(input);
    if (isNaN(d.getTime())) throw new Error('Invalid date');
    ({ year, month, day } = eatParts(d));
  }
  const start = eatMidnight(year, month, day);
  const end = new Date(start.getTime() + DAY_MS - 1);
  return { start, end, dateKey: eatDateKey(start) };
}

/** Start/end instants of an EAT calendar month given `'YYYY-MM'`. */
export function eatMonthBounds(period: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  if (!m) throw new Error(`Invalid period "${period}" — expected YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) throw new Error(`Invalid period "${period}"`);
  const start = eatMidnight(year, month, 1);
  const end = new Date(eatMidnight(year, month + 1, 1).getTime() - 1);
  return { start, end };
}

/** `'YYYY-MM'` financial period key of an instant, in EAT. */
export function toEatPeriod(date: Date | string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  const { year, month } = eatParts(d);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** `'YYYY-MM-DD'` EAT calendar date of an instant. */
export function eatDateKey(date: Date): string {
  const { year, month, day } = eatParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Current EAT calendar year. */
export function eatYear(now: Date = new Date()): number {
  return eatParts(now).year;
}

/**
 * Whole EAT calendar days from `from` to `to` (to − from). Returning an item
 * on the booked return day = 0, the next EAT day = 1, etc. Negative when `to`
 * is before `from`.
 */
export function eatCalendarDaysBetween(from: Date, to: Date): number {
  const a = eatParts(from);
  const b = eatParts(to);
  return Math.round(
    (Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / DAY_MS,
  );
}
