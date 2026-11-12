import { NotFoundException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { REQUIRES_MODULE_KEY } from '../auth/decorators/requires-module.decorator';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';
import {
  DEFAULT_DOWN_PAYMENT_PCT,
  effectiveDownPaymentPct,
  rentalTerms,
} from './rental-terms';

/**
 * The storefront showed 25 % whenever a product had no down-payment % of its
 * own, while the booking stored the shop's default. Now ONE function
 * (rental-terms.ts) decides the terms, used by both create() and the public
 * quote the storefront displays.
 */

const T = 'tenant-a';
const GOWN = {
  rentalPricePerDay: '140000',
  basePrice: '950000',
  rentalDepositAmount: '350000',
  rentalDownPaymentPct: null as number | null,
};

describe('effectiveDownPaymentPct: product override → shop default → 25 %', () => {
  it('an explicit product % wins over the shop default', () => {
    expect(effectiveDownPaymentPct(40, 30)).toEqual({ pct: 40, source: 'product' });
  });
  it('a product % equal to 25 is still an override (not "missing")', () => {
    expect(effectiveDownPaymentPct(25, 30)).toEqual({ pct: 25, source: 'product' });
  });
  it('no product % → the shop default', () => {
    expect(effectiveDownPaymentPct(null, 30)).toEqual({ pct: 30, source: 'shop' });
    expect(effectiveDownPaymentPct(undefined, 50)).toEqual({ pct: 50, source: 'shop' });
  });
  it('missing configuration (no product %, no shop policy) → the platform 25 %', () => {
    expect(effectiveDownPaymentPct(null, undefined)).toEqual({ pct: DEFAULT_DOWN_PAYMENT_PCT, source: 'default' });
    expect(DEFAULT_DOWN_PAYMENT_PCT).toBe(25);
  });
  it('0 % is a valid setting (no down payment), never replaced by a default', () => {
    expect(effectiveDownPaymentPct(0, 30)).toEqual({ pct: 0, source: 'product' });
    expect(effectiveDownPaymentPct(null, 0)).toEqual({ pct: 0, source: 'shop' });
  });
  it.each([
    ['over 100', 150],
    ['negative', -5],
    ['not a number', 'abc'],
    ['empty string', ''],
    ['NaN', Number.NaN],
  ])('an invalid product value (%s) is ignored, not turned into an obligation', (_l, v) => {
    expect(effectiveDownPaymentPct(v as any, 30)).toEqual({ pct: 30, source: 'shop' });
  });
  it('an invalid shop value falls through to 25 %', () => {
    expect(effectiveDownPaymentPct(null, 400)).toEqual({ pct: 25, source: 'default' });
  });
});

describe('rentalTerms (what create() stores and the quote shows)', () => {
  it('product override: fee 140,000, 40 % → 56,000; deposit separate', () => {
    const t = rentalTerms({ ...GOWN, rentalDownPaymentPct: 40 }, { defaultDownPaymentPct: 30 });
    expect(t).toEqual({
      rentalFee: 140000, deposit: 350000, downPaymentPct: 40, downPaymentSource: 'product',
      downPayment: 56000, total: 490000, remaining: 434000,
    });
  });
  it('shop default 30 % when the product has none → 42,000 (the old page showed 25 % / 35,000)', () => {
    const t = rentalTerms(GOWN, { defaultDownPaymentPct: 30 });
    expect(t.downPaymentPct).toBe(30);
    expect(t.downPayment).toBe(42000);
    expect(t.remaining).toBe(490000 - 42000);
  });
  it('the deposit is never part of the down payment', () => {
    const a = rentalTerms({ ...GOWN, rentalDepositAmount: '0' }, { defaultDownPaymentPct: 30 });
    const b = rentalTerms({ ...GOWN, rentalDepositAmount: '999999' }, { defaultDownPaymentPct: 30 });
    expect(a.downPayment).toBe(b.downPayment);
  });
  it('approved bouquet values: 400,000 fee, 25 % → 100,000; deposit 200,000; due before pickup 500,000', () => {
    const t = rentalTerms(
      { rentalPricePerDay: '400000', basePrice: '1200000', rentalDepositAmount: '200000', rentalDownPaymentPct: 25 },
      { defaultDownPaymentPct: 30 },
    );
    expect([t.downPayment, t.remaining, t.total]).toEqual([100000, 500000, 600000]);
  });
  it('fee and deposit rules are unchanged from create(): no rental price → 10 % of retail; no deposit → 0', () => {
    const t = rentalTerms({ basePrice: '900000' }, null);
    expect(t.rentalFee).toBe(90000);
    expect(t.deposit).toBe(0);
    expect(t.downPayment).toBe(22500);
  });
});

function makeService(product: any, policy: any) {
  const prisma: any = {
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
  };
  const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
  return { svc, prisma };
}

describe('GET /rentals/quote/:productId', () => {
  const handler = RentalsController.prototype.getQuote;

  it('is @Public, throttled, and still behind the rentals module', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, RentalsController)).toBe('rentals');
    expect(Reflect.getMetadata(REQUIRES_MODULE_KEY, handler)).toBeUndefined();
  });

  it('is tenant-scoped and limited to active, rental-eligible, non-deleted products', async () => {
    const { svc, prisma } = makeService(GOWN, { defaultDownPaymentPct: 30 });
    await svc.getQuote('p1');
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p1', tenantId: T, isActive: true, deletedAt: null,
      availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
    });
    expect(prisma.rentalPolicy.findFirst.mock.calls[0][0].where).toEqual({ tenantId: T });
  });

  it('unknown / hidden / purchase-only product → 404', async () => {
    const { svc } = makeService(null, null);
    await expect(svc.getQuote('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns amounts only: no ids, no policy internals, no source', async () => {
    const { svc } = makeService(GOWN, { defaultDownPaymentPct: 30 });
    const q = await svc.getQuote('p1');
    expect(Object.keys(q).sort()).toEqual(['deposit', 'downPayment', 'downPaymentPct', 'remaining', 'rentalFee', 'total']);
    expect(q).toEqual({ rentalFee: 140000, deposit: 350000, downPaymentPct: 30, downPayment: 42000, total: 490000, remaining: 448000 });
  });

  it('missing configuration (no policy row, no product %) → 25 %', async () => {
    const { svc } = makeService(GOWN, null);
    expect((await svc.getQuote('p1')).downPaymentPct).toBe(25);
  });

  it('changed configuration shows at once (read fresh per call, nothing cached)', async () => {
    const { svc, prisma } = makeService(GOWN, { defaultDownPaymentPct: 25 });
    expect((await svc.getQuote('p1')).downPayment).toBe(35000);
    prisma.rentalPolicy.findFirst.mockResolvedValue({ defaultDownPaymentPct: 40 });
    expect((await svc.getQuote('p1')).downPayment).toBe(56000);
    prisma.product.findFirst.mockResolvedValue({ ...GOWN, rentalDownPaymentPct: 10 });
    expect((await svc.getQuote('p1')).downPayment).toBe(14000);
  });
});

describe('create() stores exactly what the quote showed', () => {
  function bookingService(product: any, policy: any) {
    const created: any[] = [];
    const tx: any = {
      $executeRaw: jest.fn(),
      rentalOrder: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => { created.push(data); return data; }),
      },
    };
    const prisma: any = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'A', lastName: 'B', phone: '0712', email: 'a@b.c', addresses: [{ id: 'a1' }] }), findUnique: jest.fn().mockResolvedValue({ id: 'u1', firstName: 'A', lastName: 'B', phone: '0712', email: 'a@b.c', addresses: [{ id: 'a1' }] }) },
      address: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: 'a1' }) },
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', tenantId: T, availabilityMode: 'BOTH', isActive: true, deletedAt: null, bufferDaysOverride: null, ...product }),
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', ...product }),
      },
      productVariant: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', productId: 'p1', tenantId: T, isActive: true }) },
      rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
      rentalOrder: { count: jest.fn().mockResolvedValue(0) },
      customerIDDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
    return { svc, created };
  }

  it.each([
    ['product override', { ...GOWN, rentalDownPaymentPct: 40 }, { defaultDownPaymentPct: 30 }],
    ['shop default', GOWN, { defaultDownPaymentPct: 30 }],
    ['missing configuration', GOWN, null],
  ])('%s: stored downPaymentAmount / fee / deposit = the quote', async (_l, product, policy) => {
    const quote = await makeService(product, policy).svc.getQuote('p1');
    const { svc, created } = bookingService(product, policy);
    const start = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10);
    await svc.create('u1', { productId: 'p1', variantId: 'v1', startDate: start, returnDate: end, pickupDate: start } as any);
    expect(created).toHaveLength(1);
    expect(Number(created[0].downPaymentAmount)).toBe(quote.downPayment);
    expect(Number(created[0].totalRentalPrice)).toBe(quote.rentalFee);
    expect(Number(created[0].damageDeposit)).toBe(quote.deposit);
  });
});
