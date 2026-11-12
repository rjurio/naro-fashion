import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { REQUIRES_MODULE_KEY } from '../auth/decorators/requires-module.decorator';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';
import { NON_BLOCKING_RENTAL_STATUSES } from './rental-rules';
import {
  MAX_AVAILABILITY_WINDOW_DAYS,
  RentalAvailabilityQueryDto,
  parseAvailabilityWindow,
} from './dto/rental-availability-query.dto';

/**
 * GET /rentals/availability/:productId became PUBLIC (Nov 2026) so shoppers
 * can check dates before signing in. These tests pin the safety envelope:
 * minimal response, tenant + eligibility scoping, bounded inputs, throttle.
 */

const T = 'tenant-a';
const NOW = new Date('2026-11-10T09:00:00Z');


/**
 * Prisma mock: the given model methods, plus a default for any other call
 * (findMany -> [], count -> 0, aggregate -> {_sum:{}}, others -> null). The
 * shared availability rule (Release 1) makes several reads; the tests here
 * are about money terms, not about which reads it makes.
 */
function autoPrisma(models: Record<string, any>) {
  const dflt = (fn: string) => (fn === 'findMany' ? [] : fn === 'count' ? 0 : fn === 'aggregate' ? { _sum: {} } : null);
  const model = (m: any = {}) =>
    new Proxy(m, { get: (t, fn: string) => (fn in t ? t[fn] : (t[fn] = jest.fn().mockResolvedValue(dflt(fn)))) });
  return new Proxy(models, {
    get: (t, k: string) => (k in t ? (k.startsWith('$') ? t[k] : model(t[k])) : (t[k] = model())),
  });
}

function makeService(product: any, overlapping = 0, policy: any = null) {
  const open = (start: Date, end: Date) =>
    Array.from({ length: overlapping }, (_, i) => ({ id: `r${i}`, status: 'CONFIRMED', startDate: start, returnDate: end, actualReturnDate: null }));
  const prisma: any = autoPrisma({
    product: { findFirst: jest.fn().mockResolvedValue(product ? { availabilityMode: 'RENTAL_ONLY', isActive: true, deletedAt: null, ...product } : null) },
    rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
    rentalOrder: { findMany: jest.fn().mockImplementation(() => Promise.resolve(open(new Date('2026-12-10T00:00:00Z'), new Date('2026-12-12T00:00:00Z')))) },
  });
  const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
  return { svc, prisma };
}

describe('public rental availability — controller contract', () => {
  const handler = RentalsController.prototype.getAvailability;

  it('is @Public (anonymous shoppers) …', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('… and keeps a tight per-IP throttle (20/min), not the 100/min default', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('still requires the rentals module (class-level @RequiresModule, not overridden)', () => {
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, RentalsController)).toBe('rentals');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, handler)).toBeUndefined();
  });

  it('rejects unknown query params and non-ISO dates (strict DTO)', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const meta = { type: 'query' as const, metatype: RentalAvailabilityQueryDto };
    await expect(pipe.transform({ startDate: '2026-12-10', endDate: '2026-12-12' }, meta)).resolves.toBeTruthy();
    await expect(pipe.transform({ startDate: 'tomorrow', endDate: '2026-12-12' }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform({ startDate: '2026-12-10', endDate: '2026-12-12', userId: 'x' }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('parseAvailabilityWindow (bounded inputs)', () => {
  const ok = (s: string, e: string) => parseAvailabilityWindow({ startDate: s, endDate: e }, NOW);

  it('accepts a normal future window', () => {
    const r = ok('2026-12-10', '2026-12-12');
    expect(r.start.toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-12-12T00:00:00.000Z');
  });

  it('accepts today (date-only, any timezone)', () => {
    expect(() => ok('2026-11-10', '2026-11-12')).not.toThrow();
  });

  it('rejects end <= start', () => {
    expect(() => ok('2026-12-12', '2026-12-12')).toThrow(BadRequestException);
    expect(() => ok('2026-12-12', '2026-12-10')).toThrow(/after startDate/);
  });

  it(`rejects windows longer than ${MAX_AVAILABILITY_WINDOW_DAYS} days`, () => {
    expect(() => ok('2026-12-01', '2027-03-01')).toThrow(/at most/);
  });

  it('rejects the past and the far future', () => {
    expect(() => ok('2026-10-01', '2026-10-03')).toThrow(/past/);
    expect(() => ok('2028-01-01', '2028-01-03')).toThrow(/ahead/);
  });
});

describe('RentalsService.getAvailability (public answer)', () => {
  const start = new Date('2026-12-10T00:00:00Z');
  const end = new Date('2026-12-12T00:00:00Z');

  it('returns ONLY { available } — no booking dates, ids, counts or buffer', async () => {
    const { svc } = makeService({ id: 'p1', bufferDaysOverride: null });
    const r = await svc.getAvailability('p1', start, end);
    expect(r).toEqual({ available: true });
  });

  it('reports unavailable when an overlapping booking exists', async () => {
    const { svc } = makeService({ id: 'p1', bufferDaysOverride: null }, 1);
    await expect(svc.getAvailability('p1', start, end)).resolves.toEqual({ available: false });
  });

  it('looks the product up scoped to the tenant AND rental-eligible, active, not deleted', async () => {
    const { svc, prisma } = makeService({ id: 'p1', bufferDaysOverride: null });
    await svc.getAvailability('p1', start, end);
    const where = prisma.product.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      id: 'p1',
      tenantId: T,
      isActive: true,
      deletedAt: null,
      availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
    });
  });

  it('404s for purchase-only / inactive / other-tenant products (same answer for all)', async () => {
    const { svc, prisma } = makeService(null);
    await expect(svc.getAvailability('p1', start, end)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.rentalOrder.findMany).not.toHaveBeenCalled();
  });

  it('uses the shared rule (Release 1): tenant- and product-scoped booking read', async () => {
    const { svc, prisma } = makeService({ id: 'p1', bufferDaysOverride: null }, 0, { bufferDaysBetweenRentals: 7 });
    await svc.getAvailability('p1', start, end);
    const where = prisma.rentalOrder.findMany.mock.calls[0][0].where;
    expect([where.tenantId, where.productId]).toEqual([T, 'p1']);
  });
});
