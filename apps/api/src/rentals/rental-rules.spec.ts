import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  NON_BLOCKING_RENTAL_STATUSES,
  assertRentalTransition,
  computeLateFee,
} from './rental-rules';
import { RentalsService } from './rentals.service';
import { SchedulerService } from '../scheduler/scheduler.service';

describe('computeLateFee (from booked return date, EAT days)', () => {
  // Booked return: 2026-10-10 10:00 EAT = 07:00Z
  const booked = new Date('2026-10-10T07:00:00Z');
  const base = { bookedReturnDate: booked, flatRentalPrice: 200000, latePenaltyPercent: 10 };

  it('no fee when returned on (or before) the booked return day', () => {
    expect(computeLateFee({ ...base, actualReturnDate: new Date('2026-10-10T20:00:00Z') })).toEqual({
      daysLate: 0, // 23:00 EAT same day
      lateFee: 0,
    });
    expect(computeLateFee({ ...base, actualReturnDate: new Date('2026-10-08T07:00:00Z') }).lateFee).toBe(0);
  });

  it('counts whole EAT calendar days late, not UTC days', () => {
    // 2026-10-10T21:30Z = 00:30 EAT on the 11th → 1 day late in Tanzania
    // (UTC still says the 10th).
    const r = computeLateFee({ ...base, actualReturnDate: new Date('2026-10-10T21:30:00Z') });
    expect(r.daysLate).toBe(1);
    expect(r.lateFee).toBe(20000); // 10% of 200,000
  });

  it('3 days late = 3 × pct of the booked flat price', () => {
    const r = computeLateFee({ ...base, actualReturnDate: new Date('2026-10-13T09:00:00Z') });
    expect(r).toEqual({ daysLate: 3, lateFee: 60000 });
  });

  it('a long booking returned on time is NOT charged (old maxRentalDays-from-start bug)', () => {
    const r = computeLateFee({
      bookedReturnDate: new Date('2026-11-30T07:00:00Z'),
      actualReturnDate: new Date('2026-11-30T08:00:00Z'),
      flatRentalPrice: 200000,
      latePenaltyPercent: 10,
    });
    expect(r.lateFee).toBe(0);
  });

  it('falls back to policy lateFeePerDay when price/pct give 0', () => {
    const r = computeLateFee({
      bookedReturnDate: booked,
      actualReturnDate: new Date('2026-10-12T09:00:00Z'),
      flatRentalPrice: 0,
      policyLateFeePerDay: 10000,
    });
    expect(r).toEqual({ daysLate: 2, lateFee: 20000 });
  });
});

describe('assertRentalTransition', () => {
  it('allows the normal forward path', () => {
    expect(() => assertRentalTransition('ACTIVE', 'RETURNED')).not.toThrow();
    expect(() => assertRentalTransition('RETURNED', 'INSPECTION')).not.toThrow();
    expect(() => assertRentalTransition('INSPECTION', 'CLOSED')).not.toThrow();
  });

  it('rejects skipping RETURNED (ACTIVE → INSPECTION / CLOSED)', () => {
    expect(() => assertRentalTransition('ACTIVE', 'INSPECTION')).toThrow(BadRequestException);
    expect(() => assertRentalTransition('ACTIVE', 'CLOSED')).toThrow(BadRequestException);
    expect(() => assertRentalTransition('ITEM_DISPATCHED', 'CLOSED')).toThrow(BadRequestException);
  });

  it('rejects backwards moves', () => {
    expect(() => assertRentalTransition('RETURNED', 'ACTIVE')).toThrow(BadRequestException);
  });

  it('CANCELLED only before dispatch, and is terminal', () => {
    expect(() => assertRentalTransition('ID_VERIFIED', 'CANCELLED')).not.toThrow();
    expect(() => assertRentalTransition('ACTIVE', 'CANCELLED')).toThrow(BadRequestException);
    expect(() => assertRentalTransition('CANCELLED', 'ID_VERIFIED')).toThrow(BadRequestException);
  });

  it('CANCELLED never blocks availability', () => {
    expect(NON_BLOCKING_RENTAL_STATUSES).toContain('CANCELLED');
  });
});

describe('RentalsService.updateStatus → RETURNED records late fee from booked return date', () => {
  it('writes actualReturnDate + lateFee via a status CAS', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-12T09:00:00Z')); // 2 EAT days late
    const rental = {
      id: 'r1',
      status: 'ACTIVE',
      productId: 'p1',
      startDate: new Date('2026-10-01T07:00:00Z'),
      returnDate: new Date('2026-10-10T07:00:00Z'),
      totalRentalPrice: 100000,
    };
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn().mockResolvedValueOnce(rental).mockResolvedValueOnce({ ...rental }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: { findFirst: jest.fn().mockResolvedValue({ latePenaltyPercent: 10 }) },
      rentalPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit: any = { log: jest.fn() };
    const svc = new RentalsService(prisma, { requireId: 't1' } as any, audit);
    await svc.updateStatus('r1', 'RETURNED');
    const args = prisma.rentalOrder.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: 'r1', tenantId: 't1', status: 'ACTIVE' });
    expect(args.data.lateFee).toBe(20000);
    expect(args.data.actualReturnDate).toBeInstanceOf(Date);
    jest.useRealTimers();
  });

  it('reports a concurrent status change as a conflict', async () => {
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'r1', status: 'FULLY_PAID' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const svc = new RentalsService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
    await expect(svc.updateStatus('r1', 'READY_FOR_PICKUP')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RentalsService.update — date edits re-check availability under the advisory lock', () => {
  it('rejects extending over another booking (excluding itself)', async () => {
    const rental = {
      id: 'r1',
      status: 'FULLY_PAID',
      productId: 'p1',
      startDate: new Date('2026-10-01T07:00:00Z'),
      returnDate: new Date('2026-10-05T07:00:00Z'),
      pickupDate: new Date('2026-09-30T07:00:00Z'),
    };
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      rentalOrder: { count: jest.fn().mockResolvedValue(1), update: jest.fn() },
    };
    const prisma: any = {
      rentalOrder: { findFirst: jest.fn().mockResolvedValue(rental) },
      product: { findFirst: jest.fn().mockResolvedValue({ bufferDaysOverride: null }) },
      rentalPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
    };
    const svc = new RentalsService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
    await expect(svc.update('r1', { returnDate: '2026-10-12T07:00:00Z' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.$executeRaw).toHaveBeenCalled();
    const where = tx.rentalOrder.count.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 'r1' });
    expect(where.status.notIn).toContain('CANCELLED');
    expect(tx.rentalOrder.update).not.toHaveBeenCalled();
  });

  it('non-date edits skip the availability check', async () => {
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: 'r1', status: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({ id: 'r1' }),
      },
      $transaction: jest.fn(),
    };
    const svc = new RentalsService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
    await svc.update('r1', { notes: 'x' } as any);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SchedulerService.handleExpiredRentalHolds', () => {
  function make(ttl?: string, stale: any[] = []) {
    const prisma: any = {
      rentalOrder: {
        findMany: jest.fn().mockResolvedValue(stale),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const config: any = { get: jest.fn().mockReturnValue(ttl) };
    const svc = new SchedulerService(prisma, {} as any, config, {} as any, {} as any);
    return { svc, prisma };
  }

  it('cancels unpaid holds older than the TTL (default 48h) with a status CAS', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const { svc, prisma } = make(undefined, [
      { id: 'r1', tenantId: 't1', status: 'PENDING_ID_VERIFICATION', rentalNumber: 'RNT-1', notes: null },
    ]);
    const n = await svc.handleExpiredRentalHolds(now);
    expect(n).toBe(1);
    const q = prisma.rentalOrder.findMany.mock.calls[0][0].where;
    expect(q.createdAt.lt).toEqual(new Date('2026-10-02T12:00:00Z'));
    expect(q.status.in).toEqual(expect.arrayContaining(['PENDING_ID_VERIFICATION', 'PENDING_PAYMENT']));
    expect(q.payments).toEqual({ none: { status: 'COMPLETED' } });
    const u = prisma.rentalOrder.updateMany.mock.calls[0][0];
    expect(u.where).toMatchObject({ id: 'r1', tenantId: 't1', status: 'PENDING_ID_VERIFICATION' });
    expect(u.data.status).toBe('CANCELLED');
  });

  it('honours RENTAL_HOLD_TTL_HOURS', async () => {
    const now = new Date('2026-10-04T12:00:00Z');
    const { svc, prisma } = make('6');
    await svc.handleExpiredRentalHolds(now);
    expect(prisma.rentalOrder.findMany.mock.calls[0][0].where.createdAt.lt).toEqual(
      new Date('2026-10-04T06:00:00Z'),
    );
  });
});

describe('SchedulerService.getAdminContact', () => {
  it('prefers the tenant SUPER_ADMIN; env only as fallback', async () => {
    const prisma: any = {
      adminUser: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ email: 'owner@tenant.tz', phone: '255700' })
          .mockResolvedValueOnce(null),
      },
    };
    const config: any = { get: (k: string) => (k === 'ADMIN_NOTIFICATION_EMAIL' ? 'ops@platform.tz' : '') };
    const svc = new SchedulerService(prisma, {} as any, config, {} as any, {} as any);
    expect((await svc.getAdminContact('t1')).email).toBe('owner@tenant.tz');
    expect((await svc.getAdminContact('t2')).email).toBe('ops@platform.tz');
    expect(prisma.adminUser.findFirst.mock.calls[0][0].where.tenantId).toBe('t1');
  });
});
