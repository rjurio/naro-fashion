import {
  eatCalendarDaysBetween,
  eatDayBounds,
  eatMonthBounds,
  toEatPeriod,
} from './eat-time.util';

describe('EAT (UTC+3) date helpers', () => {
  it('day bounds for a YYYY-MM-DD string are EAT midnight to midnight', () => {
    const { start, end, dateKey } = eatDayBounds('2026-10-04');
    expect(start.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-04T20:59:59.999Z');
    expect(dateKey).toBe('2026-10-04');
  });

  it('day bounds for an instant use its EAT calendar day', () => {
    // 22:00Z on the 3rd = 01:00 EAT on the 4th
    expect(eatDayBounds(new Date('2026-10-03T22:00:00Z')).dateKey).toBe('2026-10-04');
  });

  it('month bounds', () => {
    const { start, end } = eatMonthBounds('2026-03');
    expect(start.toISOString()).toBe('2026-02-28T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T20:59:59.999Z');
    expect(eatMonthBounds('2026-12').end.toISOString()).toBe('2026-12-31T20:59:59.999Z');
    expect(() => eatMonthBounds('2026-13')).toThrow();
  });

  it('period key + calendar-day difference', () => {
    expect(toEatPeriod('2026-04-30T21:00:00Z')).toBe('2026-05');
    expect(eatCalendarDaysBetween(new Date('2026-10-10T07:00:00Z'), new Date('2026-10-10T21:30:00Z'))).toBe(1);
  });
});
