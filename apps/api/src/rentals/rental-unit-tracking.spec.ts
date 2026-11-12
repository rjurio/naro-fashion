import { ConflictException, ForbiddenException } from '@nestjs/common';
import { legacyConflicts, planUnitAllocation, unitSetHash, PlanBooking, PlanUnit } from './rental-unit-tracking';
import { RentalUnitsService } from './rental-units.service';

// R2: a product switches to per-gown availability only after a physical count
// that matches the registered gowns, approved by a different person, with
// every open booking placed on a gown. These lock the pure planner and the
// service's refusal paths; the real-database flow is in pos-rental.it.mjs
// (IT_UNIT_TRACKING=1).

const DAY = 86400e3;
const d = (n: number) => new Date(Date.UTC(2027, 0, 1) + n * DAY);
const unit = (id: string, fits: string[], over: Partial<PlanUnit> = {}): PlanUnit => ({ id, code: id.toUpperCase(), status: 'ACTIVE', fits, blocks: [], ...over });
const booking = (id: string, start: number, end: number, variantId = 'M', over: Partial<PlanBooking> = {}): PlanBooking => ({
  id, rentalNumber: `RNT-${id}`, status: 'DOWN_PAYMENT_PAID', startDate: d(start), returnDate: d(end), actualReturnDate: null, variantId, rentalUnitId: null, ...over,
});

describe('planUnitAllocation (dry run before activation)', () => {
  it('places overlapping bookings on different gowns of the size, respecting the buffer', () => {
    const p = planUnitAllocation([unit('g1', ['M']), unit('g2', ['M'])], [booking('a', 10, 12), booking('b', 13, 15)], 2, d(0));
    expect(p.ok).toBe(true);
    expect(new Set(p.assignments.map((x) => x.unitId)).size).toBe(2); // 13 < 12 + 2 days buffer → different gowns
  });

  it('refuses when no gown fits the booked size, or none is free', () => {
    expect(planUnitAllocation([unit('g1', ['S'])], [booking('a', 10, 12, 'M')], 2, d(0)).unplaced).toEqual([{ rentalId: 'a', rentalNumber: 'RNT-a', reason: 'NO_GOWN_FITS' }]);
    const p = planUnitAllocation([unit('g1', ['M'])], [booking('a', 10, 12), booking('b', 11, 13)], 2, d(0));
    expect([p.ok, p.unplaced.map((u) => u.reason)]).toEqual([false, ['NO_FREE_GOWN']]);
  });

  it('a gown in maintenance, or blocked on those dates, takes no booking', () => {
    expect(planUnitAllocation([unit('g1', ['M'], { status: 'MAINTENANCE' })], [booking('a', 10, 12)], 0, d(0)).ok).toBe(false);
    expect(planUnitAllocation([unit('g1', ['M'], { blocks: [{ startsAt: d(11), endsAt: d(14) }] })], [booking('a', 10, 12)], 0, d(0)).ok).toBe(false);
  });

  it('keeps a booking on the gown it already holds when still valid', () => {
    const p = planUnitAllocation([unit('g1', ['M']), unit('g2', ['M'])], [booking('a', 10, 12, 'M', { rentalUnitId: 'g2' })], 2, d(0));
    expect(p.assignments).toEqual([{ rentalId: 'a', rentalNumber: 'RNT-a', unitId: 'g2', unitCode: 'G2', kept: true }]);
  });

  it('an overdue gown still out with a customer holds its gown until today', () => {
    const late = booking('a', -10, -5, 'M', { status: 'ACTIVE' });
    const p = planUnitAllocation([unit('g1', ['M'])], [late, booking('b', 1, 3)], 0, d(0));
    expect(p.ok).toBe(false);
  });
});

describe('unitSetHash (what the approval re-checks)', () => {
  it('changes when a gown is added, its status or its sizes change; not with order', () => {
    const base = [unit('g1', ['M']), unit('g2', ['S'])];
    const h = unitSetHash(base);
    expect(unitSetHash([...base].reverse())).toBe(h);
    expect(unitSetHash([...base, unit('g3', ['M'])])).not.toBe(h);
    expect(unitSetHash([unit('g1', ['M', 'S']), unit('g2', ['S'])])).not.toBe(h);
    expect(unitSetHash([unit('g1', ['M'], { status: 'MAINTENANCE' }), unit('g2', ['S'])])).not.toBe(h);
  });
});

describe('legacyConflicts (deactivation safety)', () => {
  it('lists overlapping open bookings the one-at-a-time rule could not honour', () => {
    expect(legacyConflicts([booking('a', 10, 12), booking('b', 11, 13)], 0, d(0))).toEqual([['RNT-a', 'RNT-b']]);
    expect(legacyConflicts([booking('a', 10, 12), booking('b', 20, 22)], 2, d(0))).toEqual([]);
  });
});

describe('RentalUnitsService tracking gates', () => {
  function svc(over: any = {}) {
    const s: any = Object.create(RentalUnitsService.prototype);
    s.tenantContext = { requireId: 't1' };
    s.audit = { log: jest.fn() };
    const tx: any = {
      $executeRaw: jest.fn(),
      rentalUnitTrackingChange: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), updateMany: jest.fn() },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', rentalUnitTrackingActivatedAt: null, bufferDaysOverride: 2 }), updateMany: jest.fn() },
      rentalPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      rentalUnit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'g1', code: 'G1', status: 'ACTIVE', fits: [{ variantId: 'M' }], blocks: [] },
          { id: 'g2', code: 'G2', status: 'MAINTENANCE', fits: [{ variantId: 'M' }], blocks: [] },
          { id: 'g3', code: 'G3', status: 'RETIRED', fits: [], blocks: [] },
        ]),
        updateMany: jest.fn(),
      },
      rentalOrder: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      ...over,
    };
    s.prisma = {
      ...tx,
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', availabilityMode: 'RENTAL_ONLY', isActive: true, deletedAt: null }) },
      $transaction: (fn: any) => fn(tx),
    };
    return { s, tx };
  }

  it('count ≠ registered serviceable gowns (retired ones excluded) → 409 COUNT_MISMATCH, audited, nothing created', async () => {
    const { s, tx } = svc();
    const err: any = await s.requestTracking('p1', { countedQuantity: 3 }, { id: 'inv-1' }).catch((e: any) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'COUNT_MISMATCH', counted: 3, registered: 2 });
    expect(s.audit.log).toHaveBeenCalledWith('UNIT_TRACKING_COUNT_MISMATCH', 'Product', 'p1', { counted: 3, registered: 2 });
    expect(tx.rentalUnitTrackingChange.create).not.toHaveBeenCalled();
  });

  it('a gown without recorded sizes → 409 UNIT_SIZES_MISSING', async () => {
    const { s } = svc({
      rentalUnit: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', code: 'G1', status: 'ACTIVE', fits: [], blocks: [] }]), updateMany: jest.fn() },
    });
    const err: any = await s.requestTracking('p1', { countedQuantity: 1 }, { id: 'inv-1' }).catch((e: any) => e);
    expect(err.getResponse()).toMatchObject({ code: 'UNIT_SIZES_MISSING', units: ['G1'] });
  });

  it('the person who submitted the count can never approve it (403, audited) — before any lock or write', async () => {
    const { s, tx } = svc();
    s.prisma.rentalUnitTrackingChange = { findFirst: jest.fn().mockResolvedValue({ id: 'c1', productId: 'p1', requestedById: 'inv-1', status: 'REQUESTED', unitIds: [] }) };
    const err: any = await s.approveTracking('c1', {}, { id: 'inv-1' }).catch((e: any) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('SELF_APPROVAL');
    expect(s.audit.log).toHaveBeenCalledWith('UNIT_TRACKING_APPROVAL_DENIED', 'Product', 'p1', { changeId: 'c1', reason: 'SELF_APPROVAL' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('gown set changed since the count → STALE, product not activated', async () => {
    const { s, tx } = svc();
    const row = { id: 'c1', productId: 'p1', requestedById: 'inv-1', status: 'REQUESTED', unitIds: ['g1'], unitSetHash: 'something-else' };
    s.prisma.rentalUnitTrackingChange = { findFirst: jest.fn().mockResolvedValue(row), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    tx.rentalUnitTrackingChange.findFirst.mockResolvedValue(row);
    const err: any = await s.approveTracking('c1', {}, { id: 'reviewer-1' }).catch((e: any) => e);
    expect(err.getResponse()).toMatchObject({ code: 'TRACKING_REQUEST_STALE', reason: 'GOWNS_CHANGED' });
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.rentalUnit.updateMany).not.toHaveBeenCalled();
  });
});
