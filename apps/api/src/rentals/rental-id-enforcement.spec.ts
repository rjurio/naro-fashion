/**
 * National ID rule (owner-approved 2026-11-12):
 *   1. a booking request may be sent before the ID is verified;
 *   2. one approved ID per customer account, reused for later bookings;
 *   3. no confirmation, and no hand-over / dispatch, without an approved ID;
 *   4. enforced in the API (direct calls, staff actions, offline replays);
 *   5. only staff with id-verification:review approve / reject IDs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RentalsService } from './rentals.service';
import { RentalsController } from './rentals.controller';
import {
  RENTAL_WORKFLOW,
  transitionRequiresApprovedId,
  ID_NOT_APPROVED,
} from './rental-rules';
import { IdVerificationService } from '../id-verification/id-verification.service';
import { IdVerificationController } from '../id-verification/id-verification.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { MANAGER_DEFAULT_GRANTS } from '../permissions/permissions.service';
import { MANAGER_EXCLUDED } from '../roles/system-roles.seeder';

const tenant = { requireId: 't1' } as any;

describe('transitionRequiresApprovedId (pure rule)', () => {
  const inShop = ['PENDING_ID_VERIFICATION', 'ID_VERIFIED', 'DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'];
  const handedOver = ['ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED'];

  it('while the item is in the shop, every target except cancelling / staying unverified needs an approved ID', () => {
    for (const from of inShop) {
      for (const to of RENTAL_WORKFLOW) {
        const expected = to !== 'PENDING_ID_VERIFICATION';
        expect([from, to, transitionRequiresApprovedId(from, to)]).toEqual([from, to, expected]);
      }
      expect(transitionRequiresApprovedId(from, 'CANCELLED')).toBe(false);
    }
  });

  it('covers the confirmation step and every way to hand the item over, including jumps', () => {
    expect(transitionRequiresApprovedId('PENDING_ID_VERIFICATION', 'DOWN_PAYMENT_PAID')).toBe(true); // confirm
    expect(transitionRequiresApprovedId('PENDING_ID_VERIFICATION', 'ITEM_DISPATCHED')).toBe(true); // dispatch
    expect(transitionRequiresApprovedId('PENDING_ID_VERIFICATION', 'ACTIVE')).toBe(true); // collection
    expect(transitionRequiresApprovedId('PENDING_ID_VERIFICATION', 'RETURNED')).toBe(true); // skip hand-over
    expect(transitionRequiresApprovedId('READY_FOR_PICKUP', 'ACTIVE')).toBe(true);
  });

  it('never blocks a booking that has already left the shop (returns must stay possible)', () => {
    for (const from of handedOver) {
      for (const to of [...RENTAL_WORKFLOW, 'CANCELLED']) {
        expect([from, to, transitionRequiresApprovedId(from, to)]).toEqual([from, to, false]);
      }
    }
  });

  it('legacy / unknown statuses are treated as still in the shop (fail-safe)', () => {
    for (const legacy of ['CONFIRMED', 'PENDING_PAYMENT', 'PENDING', 'SOMETHING_NEW']) {
      expect(transitionRequiresApprovedId(legacy, 'ACTIVE')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
function rentalsFixture(rental: any, opts: { approved: boolean; claim?: number }) {
  const audit = { log: jest.fn() };
  const prisma: any = {
    rentalOrder: {
      findFirst: jest.fn(async () => rental),
      updateMany: jest.fn(async () => ({ count: opts.claim ?? 1 })),
      update: jest.fn(async ({ data }: any) => ({ ...rental, ...data })),
    },
    customerIDDocument: { findFirst: jest.fn(async () => (opts.approved ? { id: 'doc1' } : null)) },
    product: { findFirst: jest.fn(async () => ({ latePenaltyPercent: null })) },
    rentalPolicy: { findFirst: jest.fn(async () => null) },
    // cancelling checks whether money is held (REFUND_DUE); none in these scenarios
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })) },
    $executeRaw: jest.fn(),
  };
  // round 25D E: the cancellation's money check + write run in one transaction under the money locks
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return { svc: new RentalsService(prisma, tenant, audit as any), prisma, audit };
}

async function code422(p: Promise<unknown>) {
  try {
    await p;
  } catch (e: any) {
    expect(e).toBeInstanceOf(UnprocessableEntityException);
    return e.getResponse();
  }
  throw new Error('expected a 422');
}

describe('RentalsService.updateStatus — no confirmation or hand-over without an approved ID', () => {
  const base = { id: 'r1', tenantId: 't1', userId: 'u1', returnDate: new Date(), totalRentalPrice: 100 };

  it.each([
    ['PENDING_ID_VERIFICATION', 'ID_VERIFIED'],
    ['PENDING_ID_VERIFICATION', 'DOWN_PAYMENT_PAID'],
    ['PENDING_ID_VERIFICATION', 'READY_FOR_PICKUP'],
    ['PENDING_ID_VERIFICATION', 'ITEM_DISPATCHED'],
    ['PENDING_ID_VERIFICATION', 'ACTIVE'],
    ['PENDING_ID_VERIFICATION', 'RETURNED'],
    ['ID_VERIFIED', 'DOWN_PAYMENT_PAID'],
    ['FULLY_PAID', 'ACTIVE'],
    ['READY_FOR_PICKUP', 'ITEM_DISPATCHED'],
  ])('%s → %s without an approved ID: 422 ID_NOT_APPROVED, nothing written, denial audited', async (from, to) => {
    const { svc, prisma, audit } = rentalsFixture({ ...base, status: from }, { approved: false });
    const body: any = await code422(svc.updateStatus('r1', to, undefined, { isAdmin: true }));
    expect(body.code).toBe(ID_NOT_APPROVED);
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.customerIDDocument.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't1', userId: 'u1', verificationStatus: 'APPROVED' },
      select: { id: true },
    });
    expect(audit.log).toHaveBeenCalledWith('UPDATE_STATUS_DENIED', 'Rental', 'r1', { from, to, reason: ID_NOT_APPROVED });
  });

  it('the check reads the documents, not the status: a hand-set ID_VERIFIED with no document is still refused', async () => {
    const { svc, prisma } = rentalsFixture({ ...base, status: 'ID_VERIFIED' }, { approved: false });
    await code422(svc.updateStatus('r1', 'READY_FOR_PICKUP'));
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('offline replays (expectedStatus) are checked the same way', async () => {
    const { svc, prisma } = rentalsFixture({ ...base, status: 'READY_FOR_PICKUP' }, { approved: false });
    await code422(svc.updateStatus('r1', 'ACTIVE', 'READY_FOR_PICKUP', { isAdmin: true }));
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('cancelling an unverified booking is always allowed', async () => {
    const { svc, prisma } = rentalsFixture({ ...base, status: 'PENDING_ID_VERIFICATION' }, { approved: false });
    await svc.updateStatus('r1', 'CANCELLED');
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalled();
  });

  it('a booking already handed over can always be returned / inspected / closed', async () => {
    for (const [from, to] of [['ACTIVE', 'RETURNED'], ['RETURNED', 'INSPECTION'], ['INSPECTION', 'CLOSED']]) {
      const { svc, prisma } = rentalsFixture({ ...base, status: from }, { approved: false });
      await svc.updateStatus('r1', to);
      expect(prisma.rentalOrder.updateMany).toHaveBeenCalled();
      expect(prisma.customerIDDocument.findFirst).not.toHaveBeenCalled();
    }
  });

  it('with an approved ID the normal forward rules apply', async () => {
    const { svc, prisma, audit } = rentalsFixture({ ...base, status: 'PENDING_ID_VERIFICATION' }, { approved: true });
    await svc.updateStatus('r1', 'ID_VERIFIED');
    expect(prisma.rentalOrder.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'r1', tenantId: 't1', status: 'PENDING_ID_VERIFICATION' },
      data: { status: 'ID_VERIFIED' },
    });
    expect(audit.log).toHaveBeenCalledWith('UPDATE_STATUS', 'Rental', 'r1', expect.objectContaining({ from: 'PENDING_ID_VERIFICATION', to: 'ID_VERIFIED' }));
  });

  it('markReadyForPickup needs an approved ID too', async () => {
    const { svc, prisma } = rentalsFixture({ ...base, status: 'FULLY_PAID' }, { approved: false });
    await code422(svc.markReadyForPickup('r1'));
    expect(prisma.rentalOrder.update).not.toHaveBeenCalled();
    const ok = rentalsFixture({ ...base, status: 'FULLY_PAID' }, { approved: true });
    await ok.svc.markReadyForPickup('r1');
    expect(ok.prisma.rentalOrder.update).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('RentalsService.create — a request is accepted before the ID; the ID is read under the customer lock', () => {
  // Any model / method not listed answers "nothing found", so the same test
  // runs on production's booking path and on the release stack (availability
  // rule, quotes), whose extra reads are irrelevant to the ID decision.
  const empty = (): any => new Proxy({}, {
    get: (_t, m: string) => jest.fn(async () => (m === 'findMany' ? [] : m === 'count' ? 0 : m === 'aggregate' ? { _sum: {}, _max: {} } : null)),
  });
  const auto = (known: Record<string, any>): any => new Proxy(known, {
    get: (t, k: string) => (k in t ? t[k] : (t[k] = empty())),
  });
  function make(approved: boolean) {
    const order: string[] = [];
    const product = { id: 'p1', tenantId: 't1', isActive: true, availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 1000, rentalDepositAmount: 100, rentalDownPaymentPct: 25, bufferDaysOverride: 0, maxRentalDays: 7 };
    const tx: any = auto({
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => {
        order.push(`lock:${String(v[0])}`);
      }),
      rentalOrder: auto({
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => data),
      }),
      customerIDDocument: {
        findFirst: jest.fn(async () => {
          order.push('id-read');
          return approved ? { id: 'doc1' } : null;
        }),
        findMany: jest.fn(async () => []),
      },
    });
    const prisma: any = auto({
      user: { findUnique: jest.fn(async () => ({ firstName: 'A', lastName: 'B', phone: '1', email: 'a@b', addresses: [{}] })) },
      product: auto({ findUnique: jest.fn(async () => product), findFirst: jest.fn(async () => product) }),
      productVariant: auto({
        findUnique: jest.fn(async () => ({ id: 'v1', productId: 'p1', isActive: true })),
        findFirst: jest.fn(async () => ({ id: 'v1', productId: 'p1', isActive: true })),
      }),
      rentalOrder: auto({ count: jest.fn(async () => 0), findMany: jest.fn(async () => []) }),
      // must NOT be used outside the transaction any more
      customerIDDocument: { findFirst: jest.fn(async () => { throw new Error('ID read outside the booking transaction'); }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    });
    return { svc: new RentalsService(prisma, tenant, { log: jest.fn() } as any), tx, order };
  }
  const dto: any = { productId: 'p1', variantId: 'v1', startDate: '2027-01-10', returnDate: '2027-01-12', pickupDate: '2027-01-09' };

  it('no approved ID → the request is stored as PENDING_ID_VERIFICATION (not refused)', async () => {
    const { svc, tx } = make(false);
    const r: any = await svc.create('u1', dto);
    expect(r.status).toBe('PENDING_ID_VERIFICATION');
    expect(tx.rentalOrder.create).toHaveBeenCalled();
  });

  it('approved ID → ID_VERIFIED; the read happens after the per-customer lock (same lock as ID approval)', async () => {
    const { svc, order } = make(true);
    const r: any = await svc.create('u1', dto);
    expect(r.status).toBe('ID_VERIFIED');
    // the per-customer lock is taken after the product lock and before the ID read
    expect(order.slice(-3)).toEqual(['lock:p1', 'lock:rental-id:t1:u1', 'id-read'].slice(-3));
    expect(order.indexOf('lock:rental-id:t1:u1')).toBeGreaterThan(order.indexOf('lock:p1'));
    expect(order.indexOf('id-read')).toBeGreaterThan(order.indexOf('lock:rental-id:t1:u1'));
  });
});

// ---------------------------------------------------------------------------
describe('IdVerificationService.approve — reconciles waiting bookings, never more', () => {
  function make(opts: { claim?: number; waiting?: any[]; completed?: Record<string, number>; finalStatus?: Record<string, string> } = {}) {
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => { calls.push(`lock:${String(v[0])}`); }),
      customerIDDocument: {
        updateMany: jest.fn(async () => { calls.push('doc-cas'); return { count: opts.claim ?? 1 }; }),
        findFirst: jest.fn(async () => ({ id: 'd1', verificationStatus: 'APPROVED' })),
      },
      user: { updateMany: jest.fn(async () => ({ count: 1 })) },
      rentalOrder: {
        findMany: jest.fn(async () => opts.waiting ?? []),
        updateMany: jest.fn(async () => ({ count: 1 })),
        count: jest.fn(async () => 0),
      },
    };
    const prisma: any = {
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1', userId: 'u1', verificationStatus: 'PENDING', user: { email: null } })) },
      rentalOrder: { findFirst: jest.fn(async ({ where }: any) => ({ status: opts.finalStatus?.[where.id] ?? 'ID_VERIFIED' })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const settlement: any = {
      sumCompleted: jest.fn(async ({ rentalOrderId }: any) => opts.completed?.[rentalOrderId] ?? 0),
      updateRentalPaymentStatus: jest.fn(async () => undefined),
    };
    const audit = { log: jest.fn() };
    const svc = new IdVerificationService(prisma, { sendIdVerificationUpdate: jest.fn() } as any, tenant, audit as any, settlement);
    return { svc, tx, prisma, settlement, audit, calls };
  }

  it('locks the customer first, then claims the document PENDING → APPROVED (CAS)', async () => {
    const { svc, tx, calls } = make();
    await svc.approve('d1');
    expect(calls.slice(0, 2)).toEqual(['lock:rental-id:t1:u1', 'doc-cas']);
    expect(tx.customerIDDocument.updateMany.mock.calls[0][0].where).toEqual({ id: 'd1', tenantId: 't1', verificationStatus: 'PENDING' });
  });

  it('moves ONLY this customer\'s PENDING_ID_VERIFICATION bookings in this tenant, each with a status CAS', async () => {
    const { svc, tx } = make({
      waiting: [{ id: 'r1', rentalNumber: 'R1', downPaymentAmount: 250 }, { id: 'r2', rentalNumber: 'R2', downPaymentAmount: 0 }],
    });
    const before = Date.now();
    const res: any = await svc.approve('d1');
    // live waiting bookings only: deadline paused or still running, pickup day not over
    const live = {
      tenantId: 't1',
      userId: 'u1',
      status: 'PENDING_ID_VERIFICATION',
      pickupDate: { gte: expect.any(Date) },
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: expect.any(Date) } }],
    };
    expect(tx.rentalOrder.findMany.mock.calls[0][0].where).toEqual(live);
    // r1: a FRESH 48 h down-payment window from the approval
    const r1 = tx.rentalOrder.updateMany.mock.calls.find((c: any) => c[0].where.id === 'r1')[0];
    expect(r1.where).toEqual({ ...live, id: 'r1' });
    expect(r1.data).toEqual({ status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: expect.any(Date) });
    const due = r1.data.holdExpiresAt.getTime() - before;
    expect(due).toBeGreaterThanOrEqual(48 * 3600e3 - 5e3);
    expect(due).toBeLessThanOrEqual(48 * 3600e3 + 5e3);
    // r2: 0 % down payment -> no payment deadline, NOT confirmed automatically
    const r2 = tx.rentalOrder.updateMany.mock.calls.find((c: any) => c[0].where.id === 'r2')[0];
    expect(r2.data).toEqual({ status: 'ID_VERIFIED', holdState: 'NO_DOWN_PAYMENT', holdExpiresAt: null });
    expect(res.reconciled).toEqual({
      idVerified: 2, confirmed: 0, rentalNumbers: ['R1', 'R2'], expired: 0, paymentDueBy: expect.any(String),
    });
  });

  it('confirms a waiting booking only through the shared payment roll-up, and only when COMPLETED payments exist', async () => {
    const { svc, settlement } = make({
      waiting: [{ id: 'paid', rentalNumber: 'P' }, { id: 'unpaid', rentalNumber: 'U' }],
      completed: { paid: 250 },
      finalStatus: { paid: 'DOWN_PAYMENT_PAID' },
    });
    const res: any = await svc.approve('d1');
    expect(settlement.updateRentalPaymentStatus).toHaveBeenCalledTimes(1);
    expect(settlement.updateRentalPaymentStatus).toHaveBeenCalledWith('paid', 't1');
    expect(res.reconciled).toMatchObject({ idVerified: 2, confirmed: 1 });
  });

  it('pending / processing payments never confirm (sumCompleted counts COMPLETED only)', async () => {
    const { svc, settlement } = make({ waiting: [{ id: 'r1', rentalNumber: 'R1' }], completed: {} });
    await svc.approve('d1');
    expect(settlement.updateRentalPaymentStatus).not.toHaveBeenCalled();
  });

  it('a repeated / concurrent approval (document no longer PENDING) is refused and changes nothing', async () => {
    const { svc, tx, settlement, audit } = make({ claim: 0, waiting: [{ id: 'r1', rentalNumber: 'R1' }] });
    await expect(svc.approve('d1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.rentalOrder.findMany).not.toHaveBeenCalled();
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(settlement.updateRentalPaymentStatus).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('audits the approval and every booking it moved', async () => {
    const { svc, audit } = make({ waiting: [{ id: 'r1', rentalNumber: 'R1' }] });
    await svc.approve('d1');
    expect(audit.log).toHaveBeenCalledWith('UPDATE_STATUS', 'Rental', 'r1', {
      from: 'PENDING_ID_VERIFICATION', to: 'ID_VERIFIED', source: 'ID_APPROVED', idDocumentId: 'd1',
      holdState: 'NO_DOWN_PAYMENT', holdExpiresAt: null,
    });
    expect(audit.log).toHaveBeenCalledWith('APPROVE_ID', 'CustomerIDDocument', 'd1', {
      idVerified: 1, confirmed: 0, expired: 0, paymentDueBy: null,
    });
  });

  it('reject: CAS on PENDING under the customer lock; paused bookings keep their status and get an explicit resubmission window; audited', async () => {
    const audit = { log: jest.fn() };
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => { calls.push(`lock:${String(v[0])}`); }),
      customerIDDocument: {
        updateMany: jest.fn(async () => { calls.push('doc-cas'); return { count: 1 }; }),
        findFirst: jest.fn(async () => ({ id: 'd1', verificationStatus: 'REJECTED' })),
      },
      rentalOrder: {
        findMany: jest.fn(async () => [{ rentalNumber: 'R1' }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma: any = {
      customerIDDocument: {
        findFirst: jest.fn(async () => ({ id: 'd1', userId: 'u1', verificationStatus: 'PENDING', user: { email: null } })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new IdVerificationService(prisma, {} as any, tenant, audit as any, {} as any);
    await svc.reject('d1', { reason: 'Blurred photo' });
    expect(calls.slice(0, 2)).toEqual(['lock:rental-id:t1:u1', 'doc-cas']);
    expect(tx.customerIDDocument.updateMany.mock.calls[0][0].where).toEqual({ id: 'd1', tenantId: 't1', verificationStatus: 'PENDING' });
    const upd = tx.rentalOrder.updateMany.mock.calls[0][0];
    // status is NOT changed; only paused (or legacy) waiting bookings get the window
    expect(upd.data).toEqual({ holdState: 'ID_REJECTED', holdExpiresAt: expect.any(Date) });
    expect(upd.where).toMatchObject({ tenantId: 't1', userId: 'u1', status: 'PENDING_ID_VERIFICATION', holdExpiresAt: null });
    expect(upd.where.OR).toEqual([{ holdState: 'ID_UNDER_REVIEW' }, { holdState: null }]);
    expect(audit.log).toHaveBeenCalledWith('REJECT_ID', 'CustomerIDDocument', 'd1', {
      bookingsGivenResubmissionWindow: 1, holdState: 'ID_REJECTED', holdExpiresAt: expect.any(Date),
    });
    tx.customerIDDocument.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.rentalOrder.updateMany.mockClear();
    await expect(svc.reject('d1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('API-level access control', () => {
  const perms = (ctrl: any, method: string) => Reflect.getMetadata(PERMISSIONS_KEY, ctrl.prototype[method]);
  const guards = (ctrl: any, method: string) => Reflect.getMetadata(GUARDS_METADATA, ctrl.prototype[method]) ?? [];

  it('ID review (queue, approve, reject) needs id-verification:review', () => {
    for (const m of ['getPending', 'approve', 'reject']) {
      expect([m, perms(IdVerificationController, m)]).toEqual([m, ['id-verification:review']]);
      expect(guards(IdVerificationController, m)).toContain(PermissionGuard);
    }
    // the customer's own endpoints are unchanged
    expect(perms(IdVerificationController, 'submit')).toBeUndefined();
    expect(perms(IdVerificationController, 'getStatus')).toBeUndefined();
  });

  it('rental status changes and "ready for pickup" need rentals:update-status', () => {
    for (const m of ['updateStatus', 'markReadyForPickup']) {
      expect([m, perms(RentalsController, m)]).toEqual([m, ['rentals:update-status']]);
      expect(guards(RentalsController, m)).toContain(PermissionGuard);
    }
  });

  it('id-verification:review is seeded and NOT auto-granted to MANAGER', () => {
    const src = fs.readFileSync(path.join(__dirname, '../permissions/permissions.service.ts'), 'utf8');
    expect(src).toMatch(/\{ code: 'id-verification:review', name: 'Review National ID Documents'/);
    expect(MANAGER_DEFAULT_GRANTS).not.toContain('id-verification:review');
    // fresh installs too: the MANAGER system role is seeded with everything
    // except MANAGER_EXCLUDED (owner decision: SUPER_ADMIN only at first)
    expect(MANAGER_EXCLUDED).toContain('id-verification:review');
  });

  it('no code path outside the rental workflow writes a rental status', () => {
    const root = path.join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
          const s = fs.readFileSync(p, 'utf8');
          if (/rentalOrder\.(update|updateMany|upsert)\(/.test(s)) offenders.push(path.relative(root, p).replace(/\\/g, '/'));
        }
      }
    };
    walk(root);
    // Every writer is reviewed: rentals (ID-checked), settlement (ID-checked),
    // ID approval (PENDING_ID_VERIFICATION -> ID_VERIFIED only), hold expiry (-> CANCELLED only).
    expect(offenders.sort()).toEqual([
      'id-verification/id-verification.service.ts',
      'payments/payment-settlement.service.ts',
      // POS rental MVP M3: writes handover / return details only; every status
      // change goes through RentalsService.updateStatus (ID + handover gates).
      'rentals/pos-rentals.service.ts',
      // Round 25D E: flags REFUND_DUE on an already-CANCELLED booking under the money locks; never a status.
      'rentals/refund-due.ts',
      // POS rental MVP M1: writes holdState REFUND_SETTLED / REFUND_DUE only, never a status.
      'rentals/rental-money.service.ts',
      // R2: an APPROVED gown count allocates open bookings to gowns
      // (rentalUnitId only, under the booking lock), never a status.
      'rentals/rental-units.service.ts',
      'rentals/rentals.service.ts',
      'scheduler/scheduler.service.ts',
    ]);
  });
});

// The 48-hour hold rules (revised 2026-11-12: pause during ID review, fresh
// window after approval / rejection, no payment deadline at 0 %, pickup-date
// expiry) are covered in rental-hold.spec.ts.
