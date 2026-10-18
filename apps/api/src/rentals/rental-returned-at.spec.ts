import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RentalsService } from './rentals.service';
import { UpdateRentalStatusDto } from './dto/update-rental-status.dto';
import { resolveReturnedAt, RETURNED_AT_MAX_AGE_MS } from './rental-rules';

/**
 * Admin offline mode (Phase 4): a rental marked RETURNED while offline is
 * replayed later; `returnedAt` keeps the real return time so the late fee is
 * computed from when the item came back, not from when the change synced.
 */
describe('resolveReturnedAt', () => {
  const now = new Date('2026-10-18T12:00:00.000Z');

  it('defaults to now when omitted', () => {
    expect(resolveReturnedAt(undefined, now)).toEqual({ at: now });
    expect(resolveReturnedAt('', now)).toEqual({ at: now });
  });

  it('accepts a past time within 30 days', () => {
    const t = new Date(now.getTime() - 3 * 24 * 3600_000);
    expect(resolveReturnedAt(t.toISOString(), now)).toEqual({ at: t });
  });

  it('clamps small clock skew in the future to now, rejects larger', () => {
    expect(resolveReturnedAt(new Date(now.getTime() + 60_000).toISOString(), now)).toEqual({ at: now });
    expect(resolveReturnedAt(new Date(now.getTime() + 10 * 60_000).toISOString(), now)).toHaveProperty('error');
  });

  it('rejects older than 30 days and junk', () => {
    expect(resolveReturnedAt(new Date(now.getTime() - RETURNED_AT_MAX_AGE_MS - 1000).toISOString(), now)).toHaveProperty('error');
    expect(resolveReturnedAt('not-a-date', now)).toHaveProperty('error');
  });
});

describe('RentalsService.updateStatus — returnedAt', () => {
  const tenantContext: any = { requireId: 't1' };
  const audit: any = { log: jest.fn(async () => undefined) };

  function make() {
    const rental = {
      id: 'r1',
      tenantId: 't1',
      status: 'ACTIVE',
      productId: 'p1',
      returnDate: new Date(Date.now() - 10 * 24 * 3600_000),
      totalRentalPrice: 100000,
    };
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn(async () => rental),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      product: { findFirst: jest.fn(async () => ({ latePenaltyPercent: 10 })) },
      rentalPolicy: { findFirst: jest.fn(async () => null) },
    };
    return { svc: new RentalsService(prisma, tenantContext, audit), prisma, rental };
  }

  it('uses the client return time for actualReturnDate and the late fee', async () => {
    const { svc, prisma, rental } = make();
    // Returned 2 days after the booked date (offline), synced today (10 days after).
    const returnedAt = new Date(rental.returnDate.getTime() + 2 * 24 * 3600_000);
    await svc.updateStatus('r1', 'RETURNED', 'ACTIVE', { isAdmin: true }, returnedAt.toISOString());
    const data = prisma.rentalOrder.updateMany.mock.calls[0][0].data;
    expect(data.actualReturnDate).toEqual(returnedAt);
    const syncedNow = make();
    await syncedNow.svc.updateStatus('r1', 'RETURNED', 'ACTIVE', { isAdmin: true });
    const lateNow = syncedNow.prisma.rentalOrder.updateMany.mock.calls[0][0].data.lateFee;
    expect(Number(data.lateFee)).toBeLessThan(Number(lateNow));
  });

  it('rejects an out-of-range returnedAt with 400', async () => {
    const { svc, prisma } = make();
    await expect(
      svc.updateStatus('r1', 'RETURNED', 'ACTIVE', { isAdmin: true }, new Date(Date.now() + 3600_000).toISOString()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('ignores returnedAt for other statuses', async () => {
    const { svc, prisma } = make();
    prisma.rentalOrder.findFirst.mockResolvedValue({ id: 'r1', tenantId: 't1', status: 'RETURNED' });
    await svc.updateStatus('r1', 'INSPECTION', 'RETURNED', { isAdmin: true }, 'not-a-date');
    expect(prisma.rentalOrder.updateMany.mock.calls[0][0].data).toEqual({ status: 'INSPECTION' });
  });

  it('DTO accepts an ISO returnedAt and rejects junk', async () => {
    const check = async (body: any) =>
      (await validate(plainToInstance(UpdateRentalStatusDto, body), { whitelist: true, forbidNonWhitelisted: true })).map(
        (e) => e.property,
      );
    expect(await check({ status: 'RETURNED', returnedAt: new Date().toISOString() })).toEqual([]);
    expect(await check({ status: 'RETURNED', returnedAt: 'yesterday' })).toEqual(['returnedAt']);
  });
});
