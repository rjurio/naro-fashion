/**
 * Revised unconfirmed-booking (hold) rules — owner-approved 2026-11-12:
 *  - no ID submitted: 48 h from booking (unchanged), customer notified;
 *  - ID submitted, waiting for staff: the deadline is PAUSED;
 *  - ID approved: a FRESH 48 h window for the down payment;
 *  - ID rejected: an explicit 48 h window to submit a new one;
 *  - 0 % down payment: never cancelled for non-payment (and never
 *    auto-confirmed either);
 *  - the pickup day is a separate expiry, so nothing stays open forever;
 *  - race-safe against approval, payment and rescheduling; idempotent.
 */
import { ConflictException } from '@nestjs/common';
import {
  adoptLegacyHold,
  decideHold,
  formatEatDeadline,
  holdExpiryMessage,
  holdExpiryReason,
  INFLIGHT_PAYMENT_GRACE_HOURS,
  pickupCutoff,
  pickupExpiryAt,
  rejectedHold,
  rentalHoldTtlHours,
} from './rental-hold';
import { UNPAID_HOLD_STATUSES } from './rental-rules';
import { customerIdState } from '../id-verification/id-approval';
import { SchedulerService } from '../scheduler/scheduler.service';
import { IdVerificationService } from '../id-verification/id-verification.service';

const H = 3600e3;
const at = new Date('2026-11-12T09:00:00Z');

describe('decideHold (pure)', () => {
  it('no ID (or only a rejected one): 48 h from the event — the existing rule', () => {
    for (const idState of ['NONE', 'REJECTED'] as const) {
      expect(decideHold({ idState, downPaymentAmount: 250, at, ttlHours: 48 })).toEqual({
        holdState: 'AWAITING_ID',
        holdExpiresAt: new Date(at.getTime() + 48 * H),
      });
    }
  });

  it('ID waiting for staff review: the clock is paused (no deadline)', () => {
    expect(decideHold({ idState: 'PENDING', downPaymentAmount: 250, at })).toEqual({
      holdState: 'ID_UNDER_REVIEW',
      holdExpiresAt: null,
    });
  });

  it('ID approved and a down payment due: 48 h from the approval', () => {
    expect(decideHold({ idState: 'APPROVED', downPaymentAmount: 250, at, ttlHours: 48 })).toEqual({
      holdState: 'AWAITING_DOWN_PAYMENT',
      holdExpiresAt: new Date(at.getTime() + 48 * H),
    });
  });

  it('ID approved and 0 % down payment: no payment deadline at all', () => {
    for (const dp of [0, -0, NaN]) {
      expect(decideHold({ idState: 'APPROVED', downPaymentAmount: dp, at })).toEqual({
        holdState: 'NO_DOWN_PAYMENT',
        holdExpiresAt: null,
      });
    }
  });

  it('rejection gives an explicit resubmission window', () => {
    expect(rejectedHold(at, 48)).toEqual({ holdState: 'ID_REJECTED', holdExpiresAt: new Date(at.getTime() + 48 * H) });
  });

  it('RENTAL_HOLD_TTL_HOURS drives every timed window (default 48)', () => {
    expect(rentalHoldTtlHours(undefined)).toBe(48);
    expect(rentalHoldTtlHours('')).toBe(48);
    expect(rentalHoldTtlHours('0')).toBe(48);
    expect(rentalHoldTtlHours('abc')).toBe(48);
    expect(rentalHoldTtlHours('72')).toBe(72);
    expect(decideHold({ idState: 'NONE', downPaymentAmount: 1, at, ttlHours: 6 }).holdExpiresAt).toEqual(new Date(at.getTime() + 6 * H));
  });
});

describe('pickup-day expiry (EAT calendar day)', () => {
  it('a booking for pickup on 20 Nov expires at 00:00 EAT on 21 Nov (= 20 Nov 21:00 UTC)', () => {
    // storefront dates arrive as YYYY-MM-DD -> UTC midnight = 03:00 EAT that day
    const pickup = new Date('2026-11-20T00:00:00Z');
    expect(pickupExpiryAt(pickup)).toEqual(new Date('2026-11-20T21:00:00Z'));
    // an EAT-midnight timestamp of the same day expires at the same instant
    expect(pickupExpiryAt(new Date('2026-11-19T21:00:00Z'))).toEqual(new Date('2026-11-20T21:00:00Z'));
  });

  it('still collectable all through the pickup day, expired from the next EAT day', () => {
    const r = { holdExpiresAt: null, pickupDate: new Date('2026-11-20T00:00:00Z') };
    expect(holdExpiryReason(r, new Date('2026-11-20T20:59:59Z'))).toBeNull();
    expect(holdExpiryReason(r, new Date('2026-11-20T21:00:00Z'))).toBe('PICKUP_DATE_PASSED');
    expect(pickupCutoff(new Date('2026-11-20T21:00:00Z'))).toEqual(new Date('2026-11-20T21:00:00Z'));
  });

  it('a paused (ID under review) or 0 % booking is bounded only by the pickup day', () => {
    const r = { holdExpiresAt: null, pickupDate: new Date('2026-12-01T00:00:00Z') };
    expect(holdExpiryReason(r, new Date('2026-11-29T12:00:00Z'))).toBeNull();
    expect(holdExpiryReason(r, new Date('2026-12-02T00:00:00Z'))).toBe('PICKUP_DATE_PASSED');
  });

  it('the deadline counts first when both have passed', () => {
    const r = { holdExpiresAt: new Date('2026-11-10T00:00:00Z'), pickupDate: new Date('2026-11-09T00:00:00Z') };
    expect(holdExpiryReason(r, new Date('2026-11-12T00:00:00Z'))).toBe('HOLD_DEADLINE');
  });
});

describe('legacy bookings (created before these rules) are classified, never cancelled earlier', () => {
  const created = new Date('2026-11-12T08:00:00Z');
  const base = { status: 'PENDING_ID_VERIFICATION', createdAt: created, downPaymentAmount: 250, ttlHours: 48 };
  const oldRule = created.getTime() + 48 * H;

  it('every classification gives a deadline >= the old rule (created + 48 h), or none', () => {
    const cases = [
      { idState: 'NONE' as const },
      { idState: 'PENDING' as const },
      { idState: 'REJECTED' as const, rejectedAt: new Date(created.getTime() - 5 * H) },
      { idState: 'REJECTED' as const, rejectedAt: new Date(created.getTime() + 5 * H) },
      { idState: 'APPROVED' as const, approvedAt: new Date(created.getTime() - 5 * H) },
      { idState: 'APPROVED' as const, approvedAt: new Date(created.getTime() + 30 * H) },
    ];
    for (const status of ['PENDING_ID_VERIFICATION', 'ID_VERIFIED', 'PENDING_PAYMENT', 'PENDING']) {
      for (const c of cases) {
        for (const dp of [0, 250]) {
          const d = adoptLegacyHold({ ...base, ...c, status, downPaymentAmount: dp });
          if (d.holdExpiresAt) expect(d.holdExpiresAt.getTime()).toBeGreaterThanOrEqual(oldRule);
        }
      }
    }
  });

  it('maps each situation to the right state', () => {
    expect(adoptLegacyHold({ ...base, idState: 'NONE' })).toEqual({ holdState: 'AWAITING_ID', holdExpiresAt: new Date(oldRule) });
    expect(adoptLegacyHold({ ...base, idState: 'PENDING' })).toEqual({ holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null });
    expect(adoptLegacyHold({ ...base, idState: 'REJECTED', rejectedAt: new Date(created.getTime() + 5 * H) })).toEqual({
      holdState: 'ID_REJECTED',
      holdExpiresAt: new Date(created.getTime() + 53 * H),
    });
    expect(adoptLegacyHold({ ...base, idState: 'APPROVED', approvedAt: new Date(created.getTime() + 30 * H) })).toEqual({
      holdState: 'AWAITING_DOWN_PAYMENT',
      holdExpiresAt: new Date(created.getTime() + 78 * H),
    });
    expect(adoptLegacyHold({ ...base, status: 'ID_VERIFIED', idState: 'APPROVED', downPaymentAmount: 0 })).toEqual({
      holdState: 'NO_DOWN_PAYMENT',
      holdExpiresAt: null,
    });
    expect(adoptLegacyHold({ ...base, status: 'PENDING_PAYMENT', idState: 'APPROVED' })).toEqual({
      holdState: 'AWAITING_DOWN_PAYMENT',
      holdExpiresAt: new Date(oldRule),
    });
  });
});

describe('customer messages', () => {
  it('fixed texts only (no free text reaches the customer email)', () => {
    expect(holdExpiryMessage('PICKUP_DATE_PASSED', 'ID_UNDER_REVIEW')).toMatch(/pickup date passed/);
    expect(holdExpiryMessage('HOLD_DEADLINE', 'AWAITING_ID')).toMatch(/No National ID was submitted/);
    expect(holdExpiryMessage('HOLD_DEADLINE', 'ID_REJECTED')).toMatch(/new National ID was not submitted/);
    expect(holdExpiryMessage('HOLD_DEADLINE', 'AWAITING_DOWN_PAYMENT')).toMatch(/down payment was not received/);
    expect(holdExpiryMessage('HOLD_DEADLINE', null)).toMatch(/not confirmed in time/);
  });

  it('deadlines are shown in EAT', () => {
    expect(formatEatDeadline(new Date('2026-11-14T12:00:00Z'))).toBe('14 Nov 2026, 15:00 EAT');
    expect(formatEatDeadline(new Date('2026-12-31T21:30:00Z'))).toBe('1 Jan 2027, 00:30 EAT');
  });
});

describe('customerIdState', () => {
  const db = (docs: any[]) => ({ customerIDDocument: { findMany: jest.fn(async () => docs) } });
  it('APPROVED wins; else the latest document; else NONE', async () => {
    const v = new Date('2026-11-01T00:00:00Z');
    expect((await customerIdState(db([]), 't', 'u')).state).toBe('NONE');
    expect(await customerIdState(db([{ verificationStatus: 'PENDING' }]), 't', 'u')).toMatchObject({ state: 'PENDING' });
    expect(await customerIdState(db([{ verificationStatus: 'REJECTED', verifiedAt: v }]), 't', 'u')).toEqual({
      state: 'REJECTED', approvedAt: null, rejectedAt: v,
    });
    expect(
      await customerIdState(db([{ verificationStatus: 'REJECTED' }, { verificationStatus: 'APPROVED', verifiedAt: v }]), 't', 'u'),
    ).toEqual({ state: 'APPROVED', approvedAt: v, rejectedAt: null });
    const d = db([]);
    await customerIdState(d, 't1', 'u1');
    expect((d.customerIDDocument.findMany.mock.calls as any[])[0][0]).toMatchObject({ where: { tenantId: 't1', userId: 'u1' }, orderBy: { createdAt: 'desc' } });
  });
});

// ---------------------------------------------------------------------------
describe('SchedulerService.handleExpiredRentalHolds (expiry job)', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  function make(opts: {
    candidates?: any[];
    current?: any;
    inflight?: number;
    cas?: number;
    legacy?: any[];
    ttl?: string;
  } = {}) {
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => { calls.push(`lock:${String(v[0])}`); }),
      rentalOrder: {
        findFirst: jest.fn(async () => { calls.push('re-read'); return opts.current; }),
        updateMany: jest.fn(async () => { calls.push('cas'); return { count: opts.cas ?? 1 }; }),
      },
      payment: { count: jest.fn(async () => opts.inflight ?? 0) },
      customerIDDocument: { findMany: jest.fn(async () => []) },
    };
    const prisma: any = {
      rentalOrder: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(opts.legacy ?? [])
          .mockResolvedValueOnce(opts.candidates ?? []),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const notifications = { sendRentalHoldExpired: jest.fn(async () => ({ sent: true })) };
    const config: any = { get: jest.fn().mockReturnValue(opts.ttl) };
    const svc = new SchedulerService(prisma, notifications as any, config, {} as any, {} as any);
    return { svc, prisma, tx, notifications, calls };
  }
  const cand = {
    id: 'r1', tenantId: 't1', userId: 'u1', productId: 'p1', rentalNumber: 'RNT-1',
    user: { email: 'c@x.tz', firstName: 'Asha' }, product: { name: 'Gown' },
  };
  const expiredNoId = {
    status: 'PENDING_ID_VERIFICATION', holdState: 'AWAITING_ID',
    holdExpiresAt: new Date('2026-11-20T11:00:00Z'), pickupDate: new Date('2026-12-05T00:00:00Z'), notes: null,
  };

  it('selects unconfirmed bookings with no COMPLETED payment whose deadline or pickup day has passed', async () => {
    const { svc, prisma } = make();
    await svc.handleExpiredRentalHolds(now);
    const legacyQ = prisma.rentalOrder.findMany.mock.calls[0][0].where;
    expect(legacyQ).toEqual({ status: { in: UNPAID_HOLD_STATUSES }, holdState: null });
    const q = prisma.rentalOrder.findMany.mock.calls[1][0].where;
    expect(q.status).toEqual({ in: UNPAID_HOLD_STATUSES });
    expect(q.payments).toEqual({ none: { status: 'COMPLETED' } });
    expect(q.OR).toEqual([{ holdExpiresAt: { lte: now } }, { pickupDate: { lt: new Date('2026-11-19T21:00:00Z') } }]);
    // no creation-time rule any more: staff review time can't cancel a booking
    expect(q.createdAt).toBeUndefined();
  });

  it('cancels under the product, customer and payment locks (same order as booking), with a CAS, and tells the customer', async () => {
    const { svc, tx, notifications, calls } = make({ candidates: [cand], current: expiredNoId });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(1);
    expect(calls).toEqual(['lock:p1', 'lock:rental-id:t1:u1', 'lock:payment:rental:r1', 're-read', 'cas']);
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toEqual({
      id: 'r1', tenantId: 't1', status: 'PENDING_ID_VERIFICATION', holdState: 'AWAITING_ID',
      holdExpiresAt: expiredNoId.holdExpiresAt, pickupDate: expiredNoId.pickupDate,
      payments: { none: { status: 'COMPLETED' } },
    });
    expect(u.data.status).toBe('CANCELLED');
    expect(u.data.notes).toMatch(/^\[Auto-cancelled 2026-11-20T12:00:00.000Z\] No National ID was submitted in time\. \(HOLD_DEADLINE, deadline 2026-11-20T11:00:00.000Z\)$/);
    expect(notifications.sendRentalHoldExpired).toHaveBeenCalledWith({
      customerEmail: 'c@x.tz', customerName: 'Asha', rentalNumber: 'RNT-1', productName: 'Gown',
      message: 'No National ID was submitted in time.', tenantId: 't1',
    });
  });

  it('re-checks under the locks: an approval / reschedule / payment that landed first wins (nothing cancelled, no email)', async () => {
    for (const current of [
      { ...expiredNoId, status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: new Date('2026-11-22T12:00:00Z') }, // approved
      { ...expiredNoId, holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null }, // ID submitted: paused
      { ...expiredNoId, status: 'DOWN_PAYMENT_PAID' }, // paid & confirmed
      null, // gone
    ]) {
      const { svc, tx, notifications } = make({ candidates: [cand], current });
      expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
      expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
    }
  });

  it('a payment in flight (PENDING / PROCESSING, < 24 h) keeps the booking until it resolves', async () => {
    const { svc, tx, notifications } = make({ candidates: [cand], current: expiredNoId, inflight: 1 });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
    const w = tx.payment.count.mock.calls[0][0].where;
    expect(w).toEqual({
      rentalOrderId: 'r1', tenantId: 't1', status: { in: ['PENDING', 'PROCESSING'] },
      createdAt: { gt: new Date(now.getTime() - INFLIGHT_PAYMENT_GRACE_HOURS * H) },
    });
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
  });

  it('idempotent: a CAS that matches nothing (second run / concurrent change) cancels and emails nothing', async () => {
    const { svc, notifications } = make({ candidates: [cand], current: expiredNoId, cas: 0 });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
    expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
  });

  it('pickup day passed while the ID was still under review: released with the pickup message', async () => {
    const current = { ...expiredNoId, holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null, pickupDate: new Date('2026-11-19T00:00:00Z') };
    const { svc, tx, notifications } = make({ candidates: [cand], current });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(1);
    expect(tx.rentalOrder.updateMany.mock.calls[0][0].data.notes).toMatch(/pickup date passed .*\(PICKUP_DATE_PASSED\)$/);
    expect((notifications.sendRentalHoldExpired.mock.calls as any[])[0][0].message).toMatch(/pickup date passed/);
  });

  it('a 0 % booking (NO_DOWN_PAYMENT) is only released by the pickup day', async () => {
    const current = { ...expiredNoId, status: 'ID_VERIFIED', holdState: 'NO_DOWN_PAYMENT', holdExpiresAt: null };
    const a = make({ candidates: [cand], current });
    expect(await a.svc.handleExpiredRentalHolds(now)).toBe(0);
    const b = make({ candidates: [cand], current: { ...current, pickupDate: new Date('2026-11-18T00:00:00Z') } });
    expect(await b.svc.handleExpiredRentalHolds(now)).toBe(1);
  });

  it('no email address -> cancelled, no email', async () => {
    const { svc, notifications } = make({ candidates: [{ ...cand, user: { email: null } }], current: expiredNoId });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(1);
    expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
  });

  it('adopts legacy bookings (holdState NULL) with a CAS on holdState NULL under the customer lock', async () => {
    const legacy = [{ id: 'old', tenantId: 't1', userId: 'u1', status: 'PENDING_ID_VERIFICATION', createdAt: new Date('2026-11-20T00:00:00Z'), downPaymentAmount: 250, rentalNumber: 'RNT-OLD' }];
    const { svc, tx, calls } = make({ legacy });
    await svc.handleExpiredRentalHolds(now);
    expect(calls[0]).toBe('lock:rental-id:t1:u1');
    expect(tx.rentalOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', tenantId: 't1', status: 'PENDING_ID_VERIFICATION', holdState: null },
      data: { holdState: 'AWAITING_ID', holdExpiresAt: new Date('2026-11-22T00:00:00Z') },
    });
  });

  it('errors are contained (the cron never throws)', async () => {
    const { svc, prisma } = make();
    prisma.rentalOrder.findMany = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(svc.handleExpiredRentalHolds(now)).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('IdVerificationService.submit pauses the customer\'s live waiting bookings', () => {
  const ref = `private://id-documents/t1/${'a'.repeat(32)}.png`;
  function make(existing: any = null) {
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => { calls.push(`lock:${String(v[0])}`); }),
      customerIDDocument: {
        findFirst: jest.fn(async () => { calls.push('dup-check'); return existing; }),
        create: jest.fn(async ({ data }: any) => { calls.push('create'); return { id: 'doc1', ...data }; }),
      },
      rentalOrder: { updateMany: jest.fn(async () => { calls.push('pause'); return { count: 2 }; }) },
    };
    const prisma: any = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    const svc = new IdVerificationService(prisma, {} as any, { requireId: 't1' } as any, {} as any, {} as any);
    return { svc, tx, calls };
  }

  it('under the customer lock: duplicate check, insert, then pause (deadline null)', async () => {
    const { svc, tx, calls } = make();
    await svc.submit('u1', { frontImageUrl: ref, backImageUrl: ref, idNumber: '1990' });
    expect(calls).toEqual(['lock:rental-id:t1:u1', 'dup-check', 'create', 'pause']);
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.data).toEqual({ holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null });
    expect(u.where).toEqual({
      tenantId: 't1', userId: 'u1', status: 'PENDING_ID_VERIFICATION',
      pickupDate: { gte: expect.any(Date) },
      // an already-expired booking is not revived by a late upload
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: expect.any(Date) } }],
    });
  });

  it('a second submission while one is pending (or after approval) is refused and pauses nothing', async () => {
    for (const status of ['PENDING', 'APPROVED']) {
      const { svc, tx } = make({ verificationStatus: status });
      await expect(svc.submit('u1', { frontImageUrl: ref, backImageUrl: ref, idNumber: '1' })).rejects.toThrow();
      expect(tx.customerIDDocument.create).not.toHaveBeenCalled();
      expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe('IdVerificationService.approve leaves expired waiting bookings to the expiry job', () => {
  it('reports them, does not advance them', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      customerIDDocument: { updateMany: jest.fn(async () => ({ count: 1 })), findFirst: jest.fn(async () => ({ id: 'd1' })) },
      user: { updateMany: jest.fn() },
      rentalOrder: { findMany: jest.fn(async () => []), updateMany: jest.fn(), count: jest.fn(async () => 1) },
    };
    const prisma: any = {
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1', userId: 'u1', verificationStatus: 'PENDING', user: { email: null } })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new IdVerificationService(prisma, {} as any, { requireId: 't1' } as any, { log: jest.fn() } as any, {} as any);
    const res: any = await svc.approve('d1');
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(res.reconciled).toMatchObject({ idVerified: 0, expired: 1, paymentDueBy: null });
  });

  it('a concurrent second approval is still refused (409)', async () => {
    const tx: any = {
      $executeRaw: jest.fn(),
      customerIDDocument: { updateMany: jest.fn(async () => ({ count: 0 })) },
      rentalOrder: { findMany: jest.fn(), updateMany: jest.fn() },
    };
    const prisma: any = {
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1', userId: 'u1', verificationStatus: 'PENDING', user: { email: null } })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new IdVerificationService(prisma, {} as any, { requireId: 't1' } as any, { log: jest.fn() } as any, {} as any);
    await expect(svc.approve('d1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe('a payment completing on a booking the expiry job already released', () => {
  it('is never re-opened or confirmed: logged for refund review', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaymentSettlementService } = require('../payments/payment-settlement.service');
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'RNT-1', status: 'CANCELLED', downPaymentAmount: 250, userId: 'u1' })),
        updateMany: jest.fn(),
      },
      payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 250 } })), findMany: jest.fn(async () => [{ amount: 250 }]) },
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
    };
    const svc = new PaymentSettlementService(prisma);
    jest.spyOn(svc, 'sumCompleted').mockResolvedValue(250);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/REVIEW: rental RNT-1 is CANCELLED .*refund review/);
  });
});
