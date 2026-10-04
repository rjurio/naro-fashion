/**
 * Add calendar months, clamping to the last day of the target month.
 *
 * `Date.setMonth(m + 1)` overflows: Jan 31 + 1 month → "Feb 31" → Mar 3 (or
 * Mar 2 in a leap year), so a monthly subscription started on the 31st
 * silently gained 2–3 free days and drifted every cycle. This keeps the
 * time-of-day and clamps: Jan 31 → Feb 28/29, Mar 31 → Apr 30, Feb 29 + 12 →
 * Feb 28. Works in UTC so the server timezone never matters.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  // Move to day 1 first so setUTCMonth can't overflow, then clamp the day.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
