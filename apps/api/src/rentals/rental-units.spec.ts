/**
 * Unit-aware availability (POS rental MVP, M2) — POS_RENTAL_MVP_PLAN.md §1.3:
 * one gown one size; two gowns same size; one adjustable gown for several
 * sizes; no units = legacy; two sizes that really are two gowns. Plus
 * maintenance blocks, overdue units, legacy bookings without a unit, and
 * rescheduling keeping / moving the unit.
 */
import { findRentalAvailability } from './rental-availability';

const DAY = 86400e3;
const d = (n: number) => new Date(Date.UTC(2027, 0, 1) + n * DAY);
type Unit = { id: string; code: string; status?: string; fits?: string[]; blocks?: Array<[number, number]>; verified?: boolean };
type Booking = { id: string; unit?: string | null; start: number; end: number; status?: string; actual?: number };

function db(units: Unit[], bookings: Booking[] = []) {
  return {
    rentalUnit: {
      // Honours the R2 filter: only gowns verified by an approved count.
      findMany: jest.fn(async ({ where }: any = {}) =>
        units.filter((u) => !where?.trackingVerifiedAt || u.verified !== false).map((u) => ({
          id: u.id, code: u.code, status: u.status ?? 'ACTIVE',
          fits: (u.fits ?? []).map((variantId) => ({ variantId })),
          blocks: (u.blocks ?? []).map(([a, b]) => ({ startsAt: d(a), endsAt: d(b) })),
        })),
      ),
    },
    rentalOrder: {
      findMany: jest.fn(async ({ where }: any) =>
        bookings
          .filter((b) => !where.id || b.id !== where.id.not)
          .map((b) => ({
            id: b.id, status: b.status ?? 'DOWN_PAYMENT_PAID', startDate: d(b.start), returnDate: d(b.end),
            actualReturnDate: b.actual !== undefined ? d(b.actual) : null, rentalUnitId: b.unit ?? null,
          })),
      ),
    },
  };
}
const q = (over: any = {}) => ({
  tenantId: 't1',
  // R2: per-gown tracking switched on by an approved count (the cases below
  // that test the switch itself override this).
  product: { id: 'p1', availabilityMode: 'RENTAL_ONLY', isActive: true, rentalUnitTrackingActivatedAt: d(-1) },
  startDate: d(10), returnDate: d(12), bufferDays: 2, variantId: 'M', now: d(0), ...over,
});

describe('findRentalAvailability — physical units', () => {
  it('no units: legacy mode (one booking at a time, unchanged rule)', async () => {
    const a = await findRentalAvailability(db([], [{ id: 'b1', start: 10, end: 12 }]), q());
    expect(a).toEqual({ block: 'DATES_TAKEN', unitId: null, mode: 'LEGACY' });
    expect(await findRentalAvailability(db([]), q())).toEqual({ block: null, unitId: null, mode: 'LEGACY' });
  });

  it('one gown, one size: one booking at a time (same as today), the unit is allocated', async () => {
    const units = [{ id: 'u1', code: 'G-01' }];
    expect(await findRentalAvailability(db(units), q())).toEqual({ block: null, unitId: 'u1', mode: 'UNITS' });
    expect((await findRentalAvailability(db(units, [{ id: 'b1', unit: 'u1', start: 11, end: 13 }]), q())).block).toBe('DATES_TAKEN');
  });

  it('two gowns of the same size: two overlapping bookings allowed, a third refused', async () => {
    const units = [{ id: 'u1', code: 'G-01', fits: ['M'] }, { id: 'u2', code: 'G-02', fits: ['M'] }];
    expect((await findRentalAvailability(db(units, [{ id: 'b1', unit: 'u1', start: 10, end: 12 }]), q())).unitId).toBe('u2');
    expect((await findRentalAvailability(db(units, [{ id: 'b1', unit: 'u1', start: 10, end: 12 }, { id: 'b2', unit: 'u2', start: 9, end: 11 }]), q())).block).toBe('DATES_TAKEN');
  });

  it('one adjustable gown for S / M / L: bookings for ANY of those sizes compete for that one gown', async () => {
    const units = [{ id: 'u1', code: 'ADJ', fits: ['S', 'M', 'L'] }];
    const taken = [{ id: 'b1', unit: 'u1', start: 10, end: 12 }];
    for (const v of ['S', 'M', 'L']) expect((await findRentalAvailability(db(units, taken), q({ variantId: v }))).block).toBe('DATES_TAKEN');
    expect((await findRentalAvailability(db(units), q({ variantId: 'XL' }))).block).toBe('DATES_TAKEN'); // doesn't fit
  });

  it('two sizes that really are two gowns: S and L over the same dates are fine; two S are not', async () => {
    const units = [{ id: 'uS', code: 'S-1', fits: ['S'] }, { id: 'uL', code: 'L-1', fits: ['L'] }];
    const sBooked = [{ id: 'b1', unit: 'uS', start: 10, end: 12 }];
    expect((await findRentalAvailability(db(units, sBooked), q({ variantId: 'L' }))).unitId).toBe('uL');
    expect((await findRentalAvailability(db(units, sBooked), q({ variantId: 'S' }))).block).toBe('DATES_TAKEN');
  });

  it('maintenance blocks, non-ACTIVE units and buffers make a unit unavailable', async () => {
    expect((await findRentalAvailability(db([{ id: 'u1', code: 'A', blocks: [[11, 11.5]] }]), q())).block).toBe('DATES_TAKEN');
    expect((await findRentalAvailability(db([{ id: 'u1', code: 'A', blocks: [[1, 3]] }]), q())).unitId).toBe('u1');
    for (const status of ['MAINTENANCE', 'RETIRED', 'SOLD', 'LOST']) {
      expect((await findRentalAvailability(db([{ id: 'u1', code: 'A', status }]), q())).block).toBe('DATES_TAKEN');
    }
    // booking ends day 8, buffer 2 → busy until day 10: clashes with a start on day 10
    expect((await findRentalAvailability(db([{ id: 'u1', code: 'A' }], [{ id: 'b', unit: 'u1', start: 5, end: 8.5 }]), q())).block).toBe('DATES_TAKEN');
  });

  it('an overdue unit (out with a customer, past its return) holds only ITS unit, until returned', async () => {
    const units = [{ id: 'u1', code: 'A' }, { id: 'u2', code: 'B' }];
    const late = [{ id: 'b', unit: 'u1', start: -10, end: -5, status: 'ACTIVE' }];
    expect((await findRentalAvailability(db(units, late), q())).unitId).toBe('u2');
    expect((await findRentalAvailability(db([units[0]], late), q())).block).toBe('DATES_TAKEN');
  });

  it('a legacy booking with NO unit on a unit-managed product takes one unit of capacity', async () => {
    const units = [{ id: 'u1', code: 'A' }, { id: 'u2', code: 'B' }];
    expect((await findRentalAvailability(db(units, [{ id: 'old', unit: null, start: 10, end: 12 }]), q())).block).toBe(null);
    expect((await findRentalAvailability(db(units, [{ id: 'o1', unit: null, start: 10, end: 12 }, { id: 'o2', unit: null, start: 11, end: 12 }]), q())).block).toBe('DATES_TAKEN');
  });

  it('reschedule keeps the booking\'s own unit when still free, never blocks itself', async () => {
    const units = [{ id: 'u1', code: 'A' }, { id: 'u2', code: 'B' }];
    const mine = [{ id: 'me', unit: 'u2', start: 10, end: 12 }];
    const a = await findRentalAvailability(db(units, mine), q({ scope: 'reschedule', excludeRentalId: 'me', currentUnitId: 'u2', startDate: d(11), returnDate: d(13) }));
    expect(a).toEqual({ block: null, unitId: 'u2', mode: 'UNITS' });
  });

  it('inactive / non-rentable product refused before any unit logic', async () => {
    expect((await findRentalAvailability(db([{ id: 'u1', code: 'A' }]), q({ product: { id: 'p1', availabilityMode: 'PURCHASE_ONLY' } }))).block).toBe('NOT_RENTABLE_PRODUCT');
  });
});

describe('R2: registering gowns never changes availability until an approved count activates the product', () => {
  const notActivated = { id: 'p1', availabilityMode: 'RENTAL_ONLY', isActive: true, rentalUnitTrackingActivatedAt: null };
  const twoGowns = [{ id: 'u1', code: 'G-01', fits: ['M'] }, { id: 'u2', code: 'G-02', fits: ['M'] }];

  it('units registered but the product not activated: the conservative legacy rule (one booking at a time)', async () => {
    const one = [{ id: 'b1', start: 10, end: 12 }];
    expect(await findRentalAvailability(db(twoGowns, one), q({ product: notActivated }))).toEqual({ block: 'DATES_TAKEN', unitId: null, mode: 'LEGACY' });
    expect(await findRentalAvailability(db(twoGowns), q({ product: notActivated }))).toEqual({ block: null, unitId: null, mode: 'LEGACY' });
  });

  it('activation flag unknown on the passed product: read from the database (not activated → legacy)', async () => {
    const dbx: any = db(twoGowns, [{ id: 'b1', start: 10, end: 12 }]);
    dbx.product = { findFirst: jest.fn(async () => ({ rentalUnitTrackingActivatedAt: null })) };
    const r = await findRentalAvailability(dbx, q({ product: { id: 'p1', availabilityMode: 'RENTAL_ONLY', isActive: true } }));
    expect(r.mode).toBe('LEGACY');
    expect(dbx.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', tenantId: 't1' } }));
  });

  it('activated: only VERIFIED gowns count; a newly registered (uncounted) gown adds no capacity', async () => {
    const units = [{ id: 'u1', code: 'G-01', fits: ['M'] }, { id: 'u2', code: 'G-02', fits: ['M'], verified: false }];
    const r = await findRentalAvailability(db(units, [{ id: 'b1', unit: 'u1', start: 10, end: 12 }]), q());
    expect(r).toEqual({ block: 'DATES_TAKEN', unitId: null, mode: 'UNITS' });
  });

  it('activated but no verified gown at all: legacy rule (never "unlimited")', async () => {
    const units = [{ id: 'u1', code: 'G-01', verified: false }];
    expect((await findRentalAvailability(db(units, [{ id: 'b1', start: 10, end: 12 }]), q())).mode).toBe('LEGACY');
  });
});
