import { createHash } from 'crypto';
import { BOOKABLE_UNIT_STATUSES, OUT_WITH_CUSTOMER_STATUSES } from './rental-availability';

/**
 * Per-gown tracking activation (R2). Pure helpers, no I/O:
 *  - which gowns a physical count covers (serviceable = ACTIVE / MAINTENANCE);
 *  - a fingerprint of that gown set, so an approval can tell whether anything
 *    changed since the count was submitted;
 *  - a dry-run plan placing every open booking on a gown (size fits, no
 *    maintenance block, no overlap incl. the buffer). Activation is refused
 *    unless EVERY open booking can be placed.
 */
export const SERVICEABLE_UNIT_STATUSES = ['ACTIVE', 'MAINTENANCE'];

export interface PlanUnit {
  id: string;
  code: string;
  status: string;
  fits: string[]; // variant ids
  blocks: Array<{ startsAt: Date; endsAt: Date }>;
}
export interface PlanBooking {
  id: string;
  rentalNumber: string;
  status: string;
  startDate: Date;
  returnDate: Date;
  actualReturnDate?: Date | null;
  variantId: string | null;
  rentalUnitId: string | null;
}
export interface UnitPlan {
  ok: boolean;
  assignments: Array<{ rentalId: string; rentalNumber: string; unitId: string; unitCode: string; kept: boolean }>;
  unplaced: Array<{ rentalId: string; rentalNumber: string; reason: 'NO_GOWN_FITS' | 'NO_FREE_GOWN' }>;
}

export function unitSetHash(units: Array<Pick<PlanUnit, 'id' | 'status' | 'fits'>>): string {
  const canon = [...units]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((u) => `${u.id}:${u.status}:${[...u.fits].sort().join(',')}`)
    .join('|');
  return createHash('sha256').update(canon).digest('hex');
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function planUnitAllocation(units: PlanUnit[], bookings: PlanBooking[], bufferDays: number, now: Date): UnitPlan {
  const buf = bufferDays * DAY_MS;
  const window = (b: PlanBooking) => {
    const start = new Date(b.startDate).getTime();
    const booked = new Date(b.returnDate).getTime();
    const actual = b.actualReturnDate ? new Date(b.actualReturnDate).getTime() : booked;
    // Out with a customer and late: holds the gown until it comes back
    // (the same rule as live availability: it blocks every later booking).
    const end = OUT_WITH_CUSTOMER_STATUSES.includes(b.status) && booked < now.getTime() ? Number.POSITIVE_INFINITY : Math.max(booked, actual);
    return { start, end };
  };
  const clashes = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end + buf && b.start < a.end + buf;
  const bookable = units.filter((u) => BOOKABLE_UNIT_STATUSES.includes(u.status));
  const taken = new Map<string, Array<{ start: number; end: number }>>();
  const free = (u: PlanUnit, w: { start: number; end: number }) =>
    !u.blocks.some((x) => clashes(w, { start: new Date(x.startsAt).getTime(), end: new Date(x.endsAt).getTime() })) &&
    !(taken.get(u.id) ?? []).some((x) => clashes(w, x));
  const fits = (u: PlanUnit, b: PlanBooking) => u.fits.length === 0 || !b.variantId || u.fits.includes(b.variantId);

  const out: UnitPlan = { ok: true, assignments: [], unplaced: [] };
  const ordered = [...bookings].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime() || a.id.localeCompare(b.id));
  // Bookings that already hold a gown keep it when it is still valid (placed first).
  const withUnit = ordered.filter((b) => b.rentalUnitId);
  const withoutUnit = ordered.filter((b) => !b.rentalUnitId);
  const place = (b: PlanBooking, u: PlanUnit, kept: boolean) => {
    const w = window(b);
    taken.set(u.id, [...(taken.get(u.id) ?? []), w]);
    out.assignments.push({ rentalId: b.id, rentalNumber: b.rentalNumber, unitId: u.id, unitCode: u.code, kept });
  };
  const retry: PlanBooking[] = [];
  for (const b of withUnit) {
    const u = bookable.find((x) => x.id === b.rentalUnitId);
    if (u && fits(u, b) && free(u, window(b))) place(b, u, true);
    else retry.push(b);
  }
  for (const b of [...retry, ...withoutUnit].sort((a, c) => new Date(a.startDate).getTime() - new Date(c.startDate).getTime())) {
    const candidates = bookable.filter((u) => fits(u, b));
    if (candidates.length === 0) {
      out.unplaced.push({ rentalId: b.id, rentalNumber: b.rentalNumber, reason: 'NO_GOWN_FITS' });
      continue;
    }
    const u = candidates.find((x) => free(x, window(b)));
    if (u) place(b, u, false);
    else out.unplaced.push({ rentalId: b.id, rentalNumber: b.rentalNumber, reason: 'NO_FREE_GOWN' });
  }
  out.ok = out.unplaced.length === 0;
  return out;
}

/** Legacy rule = one booking at a time per product: the overlapping pairs (deactivation conflicts). */
export function legacyConflicts(bookings: PlanBooking[], bufferDays: number, now: Date): Array<[string, string]> {
  const buf = bufferDays * DAY_MS;
  const w = (b: PlanBooking) => {
    const start = new Date(b.startDate).getTime();
    const booked = new Date(b.returnDate).getTime();
    const end = OUT_WITH_CUSTOMER_STATUSES.includes(b.status) && booked < now.getTime() ? Number.POSITIVE_INFINITY : booked;
    return { start, end };
  };
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const a = w(bookings[i]);
      const b = w(bookings[j]);
      if (a.start < b.end + buf && b.start < a.end + buf) pairs.push([bookings[i].rentalNumber, bookings[j].rentalNumber]);
    }
  }
  return pairs;
}
