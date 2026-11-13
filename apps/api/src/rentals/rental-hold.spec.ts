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
 * Round 2 (2026-11-12): money received is never forfeited nor held
 * indefinitely (PAYMENT_REVIEW → REFUND_DUE → REFUND_RECORDED), in-flight
 * payments protect only within a bounded grace, confirmed no-shows are
 * flagged for staff, and customers get one reminder ~24 h before an
 * actionable deadline; designated ID reviewers need 2FA.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  adoptLegacyHold,
  decideHold,
  expiryInstant,
  formatEatDeadline,
  holdExpiryMessage,
  holdExpiryReason,
  inflightPaymentProtects,
  paymentGraceMs,
  paymentReviewHold,
  pickupCutoff,
  pickupExpiryAt,
  rejectedHold,
  reminderAction,
  rentalHoldTtlHours,
} from './rental-hold';
import { RentalsService } from './rentals.service';
import { RentalsController } from './rentals.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { idReview2faForAll, ReviewerTwoFactorGuard } from '../id-verification/reviewer-two-factor.guard';
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
    inflight?: { createdAt: Date }[];
    net?: number;
    cas?: number;
    legacy?: any[];
    noShows?: any[];
    reminders?: any[];
    reminderCurrent?: any;
    ttl?: string;
  } = {}) {
    const calls: string[] = [];
    const net = opts.net ?? 0;
    const tx: any = {
      $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...v: unknown[]) => { calls.push(`lock:${String(v[0])}`); }),
      rentalOrder: {
        findFirst: jest.fn(async () => { calls.push('re-read'); return opts.reminderCurrent !== undefined && calls.includes('reminder') ? opts.reminderCurrent : opts.current; }),
        updateMany: jest.fn(async () => { calls.push('cas'); return { count: opts.cas ?? 1 }; }),
      },
      payment: {
        findMany: jest.fn(async () => opts.inflight ?? []),
        aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where.status === 'COMPLETED' ? net : 0 } })),
      },
      customerIDDocument: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
      refundRequest: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }: any) => ({ id: 'rq1', ...data })) },
    };
    const prisma: any = {
      rentalOrder: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(opts.legacy ?? [])
          .mockResolvedValueOnce(opts.candidates ?? [])
          .mockResolvedValueOnce(opts.noShows ?? [])
          .mockImplementationOnce(async () => { calls.push('reminder'); return opts.reminders ?? []; })
          .mockResolvedValue([]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const notifications = {
      sendRentalHoldExpired: jest.fn(async () => ({ sent: true })),
      sendRentalHoldReminder: jest.fn(async () => ({ sent: true })),
    };
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

  it('selects unconfirmed bookings whose deadline or pickup day has passed (money or not: decided per booking)', async () => {
    const { svc, prisma } = make();
    await svc.handleExpiredRentalHolds(now);
    expect(prisma.rentalOrder.findMany.mock.calls[0][0].where).toEqual({ status: { in: UNPAID_HOLD_STATUSES }, holdState: null });
    const q = prisma.rentalOrder.findMany.mock.calls[1][0].where;
    expect(q.status).toEqual({ in: UNPAID_HOLD_STATUSES });
    expect(q.OR).toEqual([{ holdExpiresAt: { lte: now } }, { pickupDate: { lt: new Date('2026-11-19T21:00:00Z') } }]);
    expect(q.createdAt).toBeUndefined();
  });

  it('no money: cancels under the product, customer and payment locks (same order as booking), with a CAS, and tells the customer', async () => {
    const { svc, tx, notifications, calls } = make({ candidates: [cand], current: expiredNoId });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(1);
    expect(calls.slice(0, 5)).toEqual(['lock:p1', 'lock:rental-id:t1:u1', 'lock:payment:rental:r1', 're-read', 'cas']);
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
      message: 'No National ID was submitted in time.', moneyHeld: false, tenantId: 't1',
    });
  });

  it('re-checks under the locks: an approval / ID upload / payment that landed first wins (nothing changed, no email)', async () => {
    for (const current of [
      { ...expiredNoId, status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: new Date('2026-11-22T12:00:00Z') },
      { ...expiredNoId, holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null },
      { ...expiredNoId, status: 'DOWN_PAYMENT_PAID' },
      null,
    ]) {
      const { svc, tx, notifications } = make({ candidates: [cand], current });
      expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
      expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
    }
  });

  it('money received: NOT cancelled — moved to PAYMENT_REVIEW for 72 h (dates still held), no customer email', async () => {
    const { svc, tx, notifications } = make({ candidates: [cand], current: { ...expiredNoId, holdState: 'AWAITING_DOWN_PAYMENT', status: 'ID_VERIFIED' }, net: 50 });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.data.status).toBeUndefined();
    expect(u.data.holdState).toBe('PAYMENT_REVIEW');
    expect(u.data.holdExpiresAt).toEqual(new Date(now.getTime() + 72 * H));
    expect(u.data.notes).toMatch(/\[Payment review 2026-11-20T12:00:00.000Z\] Expired \(HOLD_DEADLINE\) with 50 TZS received; staff review until 2026-11-23T12:00:00.000Z\./);
    expect(u.where).toMatchObject({ status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT' });
    expect(u.where.payments).toBeUndefined();
    expect(notifications.sendRentalHoldExpired).not.toHaveBeenCalled();
  });

  it('PAYMENT_REVIEW still inside its window: untouched (even past the pickup day)', async () => {
    const current = { ...expiredNoId, holdState: 'PAYMENT_REVIEW', holdExpiresAt: new Date('2026-11-21T12:00:00Z'), pickupDate: new Date('2026-11-10T00:00:00Z') };
    const { svc, tx } = make({ candidates: [cand], current, net: 50 });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(0);
    expect(tx.rentalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('PAYMENT_REVIEW not resolved in time: released (dates freed) and the money flagged REFUND_DUE — never forfeited', async () => {
    const current = { ...expiredNoId, holdState: 'PAYMENT_REVIEW', holdExpiresAt: new Date('2026-11-20T11:59:00Z') };
    const { svc, tx, notifications } = make({ candidates: [cand], current, net: 50 });
    expect(await svc.handleExpiredRentalHolds(now)).toBe(1);
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toEqual({ id: 'r1', tenantId: 't1', status: 'PENDING_ID_VERIFICATION', holdState: 'PAYMENT_REVIEW', holdExpiresAt: current.holdExpiresAt });
    expect(u.data.status).toBe('CANCELLED');
    expect(u.data.holdState).toBe('REFUND_DUE');
    expect(u.data.notes).toMatch(/50 TZS received is due for refund \(REFUND_DUE\)/);
    const mail = (notifications.sendRentalHoldExpired.mock.calls as any[])[0][0];
    expect(mail.moneyHeld).toBe(true);
    expect(mail.message).toMatch(/held for refund/);
  });

  it('in-flight payment: protects only if started BEFORE the expiry, and only for the bounded grace (2 h)', async () => {
    const started = (iso: string) => [{ createdAt: new Date(iso) }];
    const deadline = expiredNoId.holdExpiresAt.toISOString(); // 11:00Z
    // started before the deadline, now 12:00 (1 h after) → kept
    let m = make({ candidates: [cand], current: expiredNoId, inflight: started('2026-11-20T10:59:00Z') });
    expect(await m.svc.handleExpiredRentalHolds(now)).toBe(0);
    expect(m.tx.rentalOrder.updateMany).not.toHaveBeenCalled();
    // started AFTER the deadline (repeated attempts) → does not protect
    m = make({ candidates: [cand], current: expiredNoId, inflight: started('2026-11-20T11:30:00Z') });
    expect(await m.svc.handleExpiredRentalHolds(now)).toBe(1);
    // started before, but the grace (deadline + 2 h = 13:00) has run out → no longer protects
    m = make({ candidates: [cand], current: expiredNoId, inflight: started('2026-11-20T10:59:00Z') });
    expect(await m.svc.handleExpiredRentalHolds(new Date('2026-11-20T13:00:00Z'))).toBe(1);
    expect(deadline).toBe('2026-11-20T11:00:00.000Z');
  });

  it('idempotent: a CAS that matches nothing (second run / concurrent change) changes and emails nothing', async () => {
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

  it('no-show rule: a CONFIRMED booking not collected by its pickup day is flagged NO_SHOW_REVIEW (never cancelled)', async () => {
    const noShows = [{ id: 'c1', tenantId: 't1', rentalNumber: 'RNT-C', status: 'DOWN_PAYMENT_PAID', pickupDate: new Date('2026-11-18T00:00:00Z'), holdState: 'AWAITING_DOWN_PAYMENT', notes: null }];
    const { svc, prisma } = make({ noShows });
    await svc.handleExpiredRentalHolds(now);
    const q = prisma.rentalOrder.findMany.mock.calls[2][0].where;
    expect(q.status).toEqual({ in: ['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'] });
    expect(q.pickupDate).toEqual({ lt: new Date('2026-11-19T21:00:00Z') });
    const u = prisma.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toEqual({ id: 'c1', tenantId: 't1', status: 'DOWN_PAYMENT_PAID', pickupDate: noShows[0].pickupDate, holdState: 'AWAITING_DOWN_PAYMENT' });
    expect(u.data).toMatchObject({ holdState: 'NO_SHOW_REVIEW', holdExpiresAt: null });
    expect(u.data.status).toBeUndefined();
  });

  it('errors are contained (the cron never throws)', async () => {
    const { svc, prisma } = make();
    prisma.rentalOrder.findMany = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(svc.handleExpiredRentalHolds(now)).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('deadline reminders (~24 h before an actionable deadline)', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const deadline = new Date('2026-11-21T10:00:00Z'); // 22 h ahead
  function make(opts: { row?: any; current?: any; cas?: number; net?: number } = {}) {
    const row = opts.row ?? {
      id: 'r1', tenantId: 't1', userId: 'u1', productId: 'p1', rentalNumber: 'RNT-1', holdExpiresAt: deadline, holdReminderFor: null,
      user: { email: 'c@x.tz', firstName: 'Asha' }, product: { name: 'Gown' },
    };
    const current = opts.current ?? {
      status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: deadline, holdReminderFor: null,
      pickupDate: new Date('2026-12-05T00:00:00Z'), downPaymentAmount: 250,
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      rentalOrder: { findFirst: jest.fn(async () => current), updateMany: jest.fn(async () => ({ count: opts.cas ?? 1 })) },
      payment: { aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where.status === 'COMPLETED' ? opts.net ?? 0 : 0 } })) },
    };
    const prisma: any = {
      rentalOrder: {
        findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([row]),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const notifications = { sendRentalHoldExpired: jest.fn(), sendRentalHoldReminder: jest.fn(async () => ({ sent: true })) };
    const svc = new SchedulerService(prisma, notifications as any, { get: () => undefined } as any, {} as any, {} as any);
    return { svc, prisma, tx, notifications };
  }

  it('selects only actionable holds (upload ID / new ID / pay) due in (now+1 h, now+24 h], pickup not passed', async () => {
    const { svc, prisma } = make();
    await svc.handleExpiredRentalHolds(now);
    const q = prisma.rentalOrder.findMany.mock.calls[3][0].where;
    expect(q.holdState).toEqual({ in: ['AWAITING_ID', 'ID_REJECTED', 'AWAITING_DOWN_PAYMENT'] });
    expect(q.holdExpiresAt).toEqual({ gt: new Date('2026-11-20T13:00:00Z'), lte: new Date('2026-11-21T12:00:00Z') });
    expect(q.status).toEqual({ in: UNPAID_HOLD_STATUSES });
  });

  it('claims by CAS under the locks, THEN emails once: deadline in EAT, amount still due, no ID details', async () => {
    const { svc, tx, notifications } = make({ net: 50 });
    await svc.handleExpiredRentalHolds(now);
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.data).toEqual({ holdReminderFor: deadline });
    expect(u.where).toMatchObject({ status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: deadline });
    expect(u.where.OR).toEqual([{ holdReminderFor: null }, { holdReminderFor: { not: deadline } }]);
    expect(notifications.sendRentalHoldReminder).toHaveBeenCalledWith({
      customerEmail: 'c@x.tz', customerName: 'Asha', rentalNumber: 'RNT-1', productName: 'Gown',
      action: 'PAY_DOWN_PAYMENT', deadline: '21 Nov 2026, 13:00 EAT', amountDue: 200, tenantId: 't1',
    });
    expect(JSON.stringify((notifications.sendRentalHoldReminder.mock.calls as any[])[0][0])).not.toMatch(/idNumber|frontImage|private:/);
  });

  it('never twice for the same deadline; a NEW deadline (fresh window) re-arms it', async () => {
    const already = make({ row: { id: 'r1', tenantId: 't1', userId: 'u1', productId: 'p1', rentalNumber: 'RNT-1', holdExpiresAt: deadline, holdReminderFor: deadline, user: { email: 'c@x.tz' }, product: {} } });
    await already.svc.handleExpiredRentalHolds(now);
    expect(already.notifications.sendRentalHoldReminder).not.toHaveBeenCalled();
    const rearmed = make({ row: { id: 'r1', tenantId: 't1', userId: 'u1', productId: 'p1', rentalNumber: 'RNT-1', holdExpiresAt: deadline, holdReminderFor: new Date('2026-11-18T10:00:00Z'), user: { email: 'c@x.tz' }, product: {} } });
    await rearmed.svc.handleExpiredRentalHolds(now);
    expect(rearmed.notifications.sendRentalHoldReminder).toHaveBeenCalledTimes(1);
  });

  it('races: approval / rejection / payment / cancellation landing first (re-read or CAS) → no reminder', async () => {
    for (const current of [
      { status: 'PENDING_ID_VERIFICATION', holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null, pickupDate: new Date('2026-12-05'), downPaymentAmount: 250 }, // ID uploaded → paused
      { status: 'DOWN_PAYMENT_PAID', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: deadline, pickupDate: new Date('2026-12-05'), downPaymentAmount: 250 }, // paid
      { status: 'CANCELLED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: deadline, pickupDate: new Date('2026-12-05'), downPaymentAmount: 250 }, // cancelled
      { status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: new Date('2026-11-22T12:00:00Z'), pickupDate: new Date('2026-12-05'), downPaymentAmount: 250 }, // fresh window (approval) → outside the 24 h window
      { status: 'ID_VERIFIED', holdState: 'NO_DOWN_PAYMENT', holdExpiresAt: deadline, pickupDate: new Date('2026-12-05'), downPaymentAmount: 0 }, // nothing to pay
    ]) {
      const m = make({ current });
      await m.svc.handleExpiredRentalHolds(now);
      expect(m.notifications.sendRentalHoldReminder).not.toHaveBeenCalled();
    }
    const lost = make({ cas: 0 });
    await lost.svc.handleExpiredRentalHolds(now);
    expect(lost.notifications.sendRentalHoldReminder).not.toHaveBeenCalled();
  });

  it('down payment already covered (settlement about to confirm) → no payment reminder', async () => {
    const { svc, notifications } = make({ net: 250 });
    await svc.handleExpiredRentalHolds(now);
    expect(notifications.sendRentalHoldReminder).not.toHaveBeenCalled();
  });

  it('upload-ID and upload-new-ID reminders link the customer to the ID page (no amount)', async () => {
    for (const [holdState, action] of [['AWAITING_ID', 'UPLOAD_ID'], ['ID_REJECTED', 'UPLOAD_NEW_ID']] as const) {
      const m = make({ current: { status: 'PENDING_ID_VERIFICATION', holdState, holdExpiresAt: deadline, holdReminderFor: null, pickupDate: new Date('2026-12-05'), downPaymentAmount: 250 } });
      await m.svc.handleExpiredRentalHolds(now);
      expect((m.notifications.sendRentalHoldReminder.mock.calls as any[])[0][0]).toMatchObject({ action, amountDue: null });
    }
  });

  it('the deadline shown is the earlier of the hold deadline and the end of the pickup day', async () => {
    const m = make({ current: { status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: deadline, holdReminderFor: null, pickupDate: new Date('2026-11-20T00:00:00Z'), downPaymentAmount: 250 } });
    await m.svc.handleExpiredRentalHolds(now);
    expect((m.notifications.sendRentalHoldReminder.mock.calls as any[])[0][0].deadline).toBe('21 Nov 2026, 00:00 EAT');
  });
});

describe('reminderAction + bounded in-flight rule (pure)', () => {
  it('only customer-actionable states', () => {
    expect(reminderAction('AWAITING_ID')).toBe('UPLOAD_ID');
    expect(reminderAction('ID_REJECTED')).toBe('UPLOAD_NEW_ID');
    expect(reminderAction('AWAITING_DOWN_PAYMENT')).toBe('PAY_DOWN_PAYMENT');
    for (const s of ['ID_UNDER_REVIEW', 'NO_DOWN_PAYMENT', 'PAYMENT_REVIEW', 'REFUND_DUE', 'REFUND_RECORDED', 'NO_SHOW_REVIEW', null]) {
      expect(reminderAction(s)).toBeNull();
    }
  });
  it('inflightPaymentProtects + expiryInstant + paymentReviewHold', () => {
    const exp = new Date('2026-11-20T11:00:00Z');
    expect(inflightPaymentProtects(new Date('2026-11-20T10:00:00Z'), exp, new Date('2026-11-20T12:59:59Z'))).toBe(true);
    expect(inflightPaymentProtects(new Date('2026-11-20T10:00:00Z'), exp, new Date('2026-11-20T13:00:00Z'))).toBe(false);
    expect(inflightPaymentProtects(new Date('2026-11-20T11:00:00Z'), exp, new Date('2026-11-20T11:01:00Z'))).toBe(false);
    expect(paymentGraceMs(undefined)).toBe(120 * 60e3);
    expect(paymentGraceMs('30')).toBe(30 * 60e3);
    const r = { holdExpiresAt: null, pickupDate: new Date('2026-11-20T00:00:00Z') };
    expect(expiryInstant(r, 'PICKUP_DATE_PASSED')).toEqual(new Date('2026-11-20T21:00:00Z'));
    expect(expiryInstant({ ...r, holdExpiresAt: exp }, 'HOLD_DEADLINE')).toEqual(exp);
    expect(paymentReviewHold(new Date('2026-11-20T00:00:00Z'), 72)).toEqual({ holdState: 'PAYMENT_REVIEW', holdExpiresAt: new Date('2026-11-23T00:00:00Z') });
  });
});

// ---------------------------------------------------------------------------
describe('ReviewerTwoFactorGuard (owner rule: designated ID reviewers need 2FA)', () => {
  const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
  const guard = (twoFA: boolean | null) =>
    new ReviewerTwoFactorGuard({ adminUser: { findFirst: jest.fn(async () => (twoFA === null ? null : { is2FAEnabled: twoFA })) } } as any);
  it('SUPER_ADMIN and platform admins pass (the owner must not be locked out)', async () => {
    await expect(guard(false).canActivate(ctx({ id: 'a', role: 'SUPER_ADMIN', isAdmin: true }))).resolves.toBe(true);
    await expect(guard(false).canActivate(ctx({ id: 'p', isPlatformAdmin: true }))).resolves.toBe(true);
  });
  it('a designated reviewer (MANAGER / STAFF role) without 2FA is refused 403 TWO_FA_REQUIRED; with 2FA passes', async () => {
    await expect(guard(false).canActivate(ctx({ id: 'm', role: 'MANAGER', isAdmin: true }))).rejects.toMatchObject({
      response: { statusCode: 403, code: 'TWO_FA_REQUIRED' },
    });
    await expect(guard(null).canActivate(ctx({ id: 'x', role: 'STAFF', isAdmin: true }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard(true).canActivate(ctx({ id: 'm', role: 'MANAGER', isAdmin: true }))).resolves.toBe(true);
  });
  it('ID_REVIEW_2FA_ALL=true ends the temporary SUPER_ADMIN / platform-admin exemption (default off)', async () => {
    const prev = process.env.ID_REVIEW_2FA_ALL;
    try {
      expect(idReview2faForAll(undefined)).toBe(false);
      expect(idReview2faForAll('TRUE')).toBe(true);
      process.env.ID_REVIEW_2FA_ALL = 'true';
      await expect(guard(false).canActivate(ctx({ id: 'a', role: 'SUPER_ADMIN', isAdmin: true }))).rejects.toMatchObject({
        response: { code: 'TWO_FA_REQUIRED' },
      });
      await expect(guard(true).canActivate(ctx({ id: 'a', role: 'SUPER_ADMIN', isAdmin: true }))).resolves.toBe(true);
      const pf = (on: boolean) =>
        new ReviewerTwoFactorGuard({ platformAdmin: { findFirst: jest.fn(async () => ({ is2FAEnabled: on })) } } as any);
      await expect(pf(false).canActivate(ctx({ id: 'p', isPlatformAdmin: true }))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(pf(true).canActivate(ctx({ id: 'p', isPlatformAdmin: true }))).resolves.toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ID_REVIEW_2FA_ALL;
      else process.env.ID_REVIEW_2FA_ALL = prev;
    }
  });

  it('is wired after PermissionGuard on the ID queue, approve, reject and the ID image route', () => {
    const fs = require('fs');
    const path = require('path');
    const idc = fs.readFileSync(path.join(__dirname, '../id-verification/id-verification.controller.ts'), 'utf8');
    expect((idc.match(/@UseGuards\(AdminGuard, PermissionGuard, ReviewerTwoFactorGuard\)/g) ?? []).length).toBe(3);
    const up = fs.readFileSync(path.join(__dirname, '../upload/upload.controller.ts'), 'utf8');
    expect(up).toMatch(/@Get\('id-document\/:tenantScopedKey'\)\s*\n\s*@UseGuards\(AdminGuard, PermissionGuard, ReviewerTwoFactorGuard\)/);
  });
});

// ---------------------------------------------------------------------------
describe('staff actions: extend a hold, cancel with money held (REFUND_DUE liability)', () => {
  const tenant = { requireId: 't1' } as any;
  const base = {
    id: 'r1', tenantId: 't1', userId: 'u1', rentalNumber: 'RNT-1', status: 'ID_VERIFIED', holdState: 'PAYMENT_REVIEW',
    holdExpiresAt: new Date(Date.now() + 3600e3), pickupDate: new Date(Date.now() + 10 * 86400e3), downPaymentAmount: 250,
  };
  function make(rental: any, opts: { net?: number; cas?: number; approved?: boolean } = {}) {
    const audit = { log: jest.fn() };
    const tx: any = {
      $executeRaw: jest.fn(),
      customerIDDocument: { findFirst: jest.fn(async () => (opts.approved === false ? null : { id: 'd1' })) },
      // Round 25C F: cancelling runs in a transaction that also raises the refund requests.
      rentalOrder: {
        updateMany: jest.fn(async () => ({ count: opts.cas ?? 1 })),
        findFirst: jest.fn(async () => ({ ...rental, status: 'CANCELLED', totalRentalPrice: 1000, damageDeposit: 0, downPaymentAmount: 250 })),
      },
      payment: {
        findMany: jest.fn(async () => (opts.net ? [{ amount: opts.net, status: 'COMPLETED', component: 'RENTAL_FEE' }] : [])),
        // R1 (#37): the cancellation reads the money held under its locks
        aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where.status === 'COMPLETED' ? opts.net ?? 0 : 0 } })),
      },
      refundRequest: { findMany: jest.fn(async () => []), create: jest.fn(async ({ data }: any) => ({ id: 'rq1', ...data })) },
    };
    const prisma: any = {
      rentalOrder: { findFirst: jest.fn(async () => rental), updateMany: jest.fn(async () => ({ count: opts.cas ?? 1 })) },
      payment: { aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where.status === 'COMPLETED' ? opts.net ?? 0 : 0 } })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new RentalsService(prisma, tenant, audit as any);
    jest.spyOn(svc, 'findOne').mockResolvedValue({ id: 'r1' } as any);
    return { svc, prisma, tx, audit };
  }
  const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

  it('EXTEND: PAYMENT_REVIEW → back to waiting for the down payment, new deadline, CAS under the customer lock, audited', async () => {
    const { svc, tx, audit } = make(base);
    await svc.extendHold('r1', { until: inDays(2), note: 'Customer will pay the rest on Friday' });
    const u = tx.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toEqual({ id: 'r1', tenantId: 't1', status: 'ID_VERIFIED', holdState: 'PAYMENT_REVIEW', holdExpiresAt: base.holdExpiresAt });
    expect(u.data.holdState).toBe('AWAITING_DOWN_PAYMENT');
    expect(audit.log).toHaveBeenCalledWith('HOLD_EXTENDED', 'Rental', 'r1', expect.objectContaining({ note: 'Customer will pay the rest on Friday' }));
  });

  it('EXTEND is bounded: future, ≤ 7 days, not past the pickup day, only waiting / review states', async () => {
    await expect(make(base).svc.extendHold('r1', { until: new Date(Date.now() - 1000).toISOString(), note: 'x' })).rejects.toThrow(/future/);
    await expect(make(base).svc.extendHold('r1', { until: inDays(8), note: 'x' })).rejects.toThrow(/at most 7 days/);
    await expect(make({ ...base, pickupDate: new Date(Date.now() + 86400e3) }).svc.extendHold('r1', { until: inDays(3), note: 'x' })).rejects.toThrow(/reschedule the pickup first/);
    for (const holdState of ['ID_UNDER_REVIEW', 'NO_DOWN_PAYMENT', 'REFUND_DUE', 'NO_SHOW_REVIEW']) {
      await expect(make({ ...base, holdState }).svc.extendHold('r1', { until: inDays(1), note: 'x' })).rejects.toThrow(/Only an unconfirmed booking/);
    }
    await expect(make({ ...base, status: 'DOWN_PAYMENT_PAID' }).svc.extendHold('r1', { until: inDays(1), note: 'x' })).rejects.toThrow(/Only an unconfirmed booking/);
    await expect(make(base, { cas: 0 }).svc.extendHold('r1', { until: inDays(1), note: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancelling a booking that holds money flags it REFUND_DUE (audited) and raises a full refund REQUEST in the same transaction; without money it is a plain cancel', async () => {
    const withMoney = make({ ...base, status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT' }, { net: 50 });
    await withMoney.svc.updateStatus('r1', 'CANCELLED', undefined, { id: 'staff1' }, undefined, { reason: 'CUSTOMER_REQUEST', note: 'wedding postponed' });
    expect(withMoney.tx.rentalOrder.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED', holdState: 'REFUND_DUE', holdExpiresAt: null, cancellationReason: 'CUSTOMER_REQUEST', cancellationNote: 'wedding postponed', cancelledById: 'staff1',
    });
    expect(withMoney.tx.refundRequest.create.mock.calls[0][0].data).toMatchObject({ kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 50, retainedAmount: 0, requestedById: 'staff1' });
    expect(withMoney.audit.log).toHaveBeenCalledWith('UPDATE_STATUS', 'Rental', 'r1', expect.objectContaining({ to: 'CANCELLED', holdState: 'REFUND_DUE', cancellationReason: 'CUSTOMER_REQUEST' }));
    const noMoney = make({ ...base, status: 'ID_VERIFIED', holdState: 'AWAITING_DOWN_PAYMENT' }, { net: 0 });
    await noMoney.svc.updateStatus('r1', 'CANCELLED');
    expect(noMoney.tx.rentalOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED', cancellationReason: 'UNSPECIFIED', cancelledById: null });
    expect(noMoney.tx.refundRequest.create).not.toHaveBeenCalled();
  });

  it('routes: extend needs rentals:update-status', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RentalsController.prototype.extendHold)).toEqual(['rentals:update-status']);
  });

  it('REFUND_DUE is a liability flag only: no route or method marks money as refunded, and the flag never writes a payment', () => {
    // Owner rule (round 24): an audit entry is not a financial refund record;
    // payouts belong to the rental refund ledger (proposed release after P0c).
    expect((RentalsController.prototype as any).recordRefund).toBeUndefined();
    expect((RentalsService.prototype as any).recordRefund).toBeUndefined();
    const fs = require('fs');
    const path = require('path');
    const ctl = fs.readFileSync(path.join(__dirname, 'rentals.controller.ts'), 'utf8');
    expect(ctl).not.toMatch(/refund-recorded|refunds?'\)/);
    for (const f of ['rentals.service.ts', 'rental-hold.ts', '../scheduler/scheduler.service.ts']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect([f, /REFUND_RECORDED/.test(src)]).toEqual([f, false]);
      // the hold code never creates or edits a payment row
      expect([f, /payment\.(create|update|updateMany|upsert)\(/.test(src)]).toEqual([f, false]);
    }
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

describe('round 25D E (R1): REFUND_DUE is decided under the money locks, from a fresh read', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { flagRefundDueIfHeld, lockRentalMoney } = require('./refund-due');
  const fakeTx = (status: string, completed: number, refunded = 0) => ({
    $executeRaw: jest.fn(),
    rentalOrder: { findFirst: jest.fn(async () => ({ status, holdState: null })), updateMany: jest.fn(async () => ({ count: 1 })) },
    payment: { aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where.status === 'COMPLETED' ? completed : refunded } })) },
  });
  it('locks payment:rental then refund:rental (fixed order, no deadlock with the hold job or the refund workflow)', async () => {
    const tx = fakeTx('CANCELLED', 0);
    await lockRentalMoney(tx, 'r1');
    expect((tx as any).$executeRaw.mock.calls.map((c: any) => c[1])).toEqual(['payment:rental:r1', 'refund:rental:r1']);
  });
  it('a booking found CANCELLED under the lock with money held is flagged REFUND_DUE; nothing held / not cancelled → untouched', async () => {
    const held = fakeTx('CANCELLED', 50000, 0);
    expect(await flagRefundDueIfHeld(held, 't1', 'r1')).toEqual({ cancelled: true, held: 50000, flagged: true });
    expect((held as any).rentalOrder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1', tenantId: 't1', status: 'CANCELLED' }, data: { holdState: 'REFUND_DUE', holdExpiresAt: null } });
    const refunded = fakeTx('CANCELLED', 50000, 50000);
    expect(await flagRefundDueIfHeld(refunded, 't1', 'r1')).toEqual({ cancelled: true, held: 0, flagged: false });
    const open = fakeTx('DOWN_PAYMENT_PAID', 50000);
    expect(await flagRefundDueIfHeld(open, 't1', 'r1')).toEqual({ cancelled: false, held: 0, flagged: false });
    expect(open.rentalOrder.updateMany).not.toHaveBeenCalled();
  });
  it('settlement: the status read BEFORE the lock is stale (not cancelled) but the booking is CANCELLED under the lock → flagged, never advanced', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaymentSettlementService } = require('../payments/payment-settlement.service');
    let reads = 0;
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'RNT-9', status: reads++ === 0 ? 'ID_VERIFIED' : 'CANCELLED', holdState: null, downPaymentAmount: 100, totalRentalPrice: 400, damageDeposit: 200, lateFee: 0, userId: 'u1' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payment: {
        aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where?.status === 'REFUNDED' ? 0 : 50 } })),
        findMany: jest.fn(async () => [{ amount: 50, status: 'COMPLETED', component: null }]),
      },
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const svc = new PaymentSettlementService(prisma);
    jest.spyOn(svc, 'sumCompleted').mockResolvedValue(50);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.rentalOrder.updateMany.mock.calls[0][0].data).toEqual({ holdState: 'REFUND_DUE', holdExpiresAt: null });
  });
});

describe('a payment completing on a booking the expiry job already released', () => {
  it('is never re-opened or confirmed: logged and flagged REFUND_DUE for finance', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaymentSettlementService } = require('../payments/payment-settlement.service');
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'RNT-1', status: 'CANCELLED', downPaymentAmount: 250, userId: 'u1' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      payment: {
        aggregate: jest.fn(async ({ where }: any) => ({ _sum: { amount: where?.status === 'REFUNDED' ? 0 : 250 } })),
        findMany: jest.fn(async () => [{ amount: 250 }]),
      },
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
      refundRequest: { findMany: jest.fn(async () => []), create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const svc = new PaymentSettlementService(prisma);
    jest.spyOn(svc, 'sumCompleted').mockResolvedValue(250);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalledTimes(1);
    const u = prisma.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toMatchObject({ id: 'r1', tenantId: 't1', status: 'CANCELLED' });
    expect(u.data).toEqual({ holdState: 'REFUND_DUE', holdExpiresAt: null }); // status stays CANCELLED
    expect(warn.mock.calls[0][0]).toMatch(/REVIEW: rental RNT-1 is CANCELLED .*refund review/);
  });

  it('round 25D E: a cancellation committing concurrently (status read BEFORE the lock is stale) — the check re-reads under the refund lock, requests the new money and never advances the booking', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PaymentSettlementService } = require('../payments/payment-settlement.service');
    const base = { id: 'r1', rentalNumber: 'RNT-2', downPaymentAmount: 100, totalRentalPrice: 400, damageDeposit: 200, lateFee: 0, userId: 'u1', tenantId: 't1' };
    let reads = 0;
    const prisma: any = {
      // 1st read (outside the lock): still DOWN_PAYMENT_PAID; afterwards (under the lock): CANCELLED.
      rentalOrder: { findFirst: jest.fn(async () => ({ ...base, status: reads++ === 0 ? 'DOWN_PAYMENT_PAID' : 'CANCELLED' })), updateMany: jest.fn() },
      payment: { findMany: jest.fn(async () => [{ amount: 100, status: 'COMPLETED', component: 'RENTAL_FEE' }, { amount: 50, status: 'COMPLETED', component: null }]) },
      customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
      // The cancellation already requested the 100 it counted; the 50 arrived after its count.
      refundRequest: { findMany: jest.fn(async () => [{ component: 'RENTAL_FEE', amount: 100, retainedAmount: 0, status: 'REQUESTED' }]), create: jest.fn(async ({ data }: any) => ({ id: 'q2', ...data })) },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const svc = new PaymentSettlementService(prisma);
    jest.spyOn(svc, 'sumCompleted').mockResolvedValue(150);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await svc.updateRentalPaymentStatus('r1', 't1');
    expect(prisma.$executeRaw).toHaveBeenCalled(); // the booking's refund lock
    expect(prisma.refundRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.refundRequest.create.mock.calls[0][0].data).toMatchObject({ kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 50, requestedById: 'SYSTEM:LATE_PAYMENT' });
    // only the REFUND_DUE flag is written — the booking is never advanced
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.rentalOrder.updateMany.mock.calls[0][0].data).toEqual({ holdState: 'REFUND_DUE', holdExpiresAt: null });
  });
});
