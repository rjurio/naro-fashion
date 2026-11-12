import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { REQUIRES_MODULE_KEY } from '../auth/decorators/requires-module.decorator';
import { CreateRentalDto } from './dto/create-rental.dto';
import { RentalsController } from './rentals.controller';
import { RentalsService, RENTAL_TERMS_CHANGED, RENTAL_TERMS_UNAVAILABLE } from './rentals.service';
import {
  DEFAULT_DOWN_PAYMENT_PCT,
  effectiveDownPaymentPct,
  quotedTermsDiffer,
  rentalTerms,
  shopDownPaymentPct,
} from './rental-terms';

/**
 * The storefront showed 25 % whenever a product had no down-payment % of its
 * own, while the booking stored the shop's default. Now ONE function
 * (rental-terms.ts) decides the terms, used by both create() and the public
 * quote the storefront displays. The quote is advisory: the booking computes
 * and stores its own amounts, and refuses (409) if they differ from the ones
 * the customer was shown.
 */

const T = 'tenant-a';
const GOWN = {
  rentalPricePerDay: '140000',
  basePrice: '950000',
  rentalDepositAmount: '350000',
  rentalDownPaymentPct: null as number | null,
};

// ---------------------------------------------------------------- owner's five cases
describe('precedence (owner, 2026-11-12): product % → shop default → 25 %', () => {
  const CASES: Array<[string, unknown, unknown, number, string]> = [
    ['product override 25 %, shop 30 %', 25, 30, 25, 'product'],
    ['no product override, shop 30 %', null, 30, 30, 'shop'],
    ['product override 0 %, shop 30 %', 0, 30, 0, 'product'],
    ['invalid product setting (150), valid shop 30 %', 150, 30, 30, 'shop'],
    ['both absent', null, undefined, 25, 'default'],
  ];
  it.each(CASES)('%s → %d %%', (_l, productPct, shopPct, pct, source) => {
    expect(effectiveDownPaymentPct(productPct as any, shopPct as any)).toMatchObject({ pct, source });
    const t = rentalTerms({ ...GOWN, rentalDownPaymentPct: productPct as any }, shopPct === undefined ? null : { defaultDownPaymentPct: shopPct as any });
    expect([t.downPaymentPct, t.downPayment]).toEqual([pct, 140000 * pct / 100]);
  });
  it.each(CASES)('the public quote gives the same answer: %s', async (_l, productPct, shopPct, pct) => {
    const { svc } = makeService({ ...GOWN, rentalDownPaymentPct: productPct }, shopPct === undefined ? null : { defaultDownPaymentPct: shopPct });
    const q = await svc.getQuote(`p-case-${String(productPct)}-${String(shopPct)}`);
    expect(q.downPaymentPct).toBe(pct);
    expect(q.downPayment).toBe(140000 * pct / 100);
    expect(q.remaining).toBe(490000 - q.downPayment);
  });
  it('the fallback is the documented 25 %', () => expect(DEFAULT_DOWN_PAYMENT_PCT).toBe(25));
});

describe('effectiveDownPaymentPct details', () => {
  it('a product % equal to 25 is still an override (not "missing")', () => {
    expect(effectiveDownPaymentPct(25, 30)).toMatchObject({ pct: 25, source: 'product' });
  });
  it('0 % at shop level is valid too', () => {
    expect(effectiveDownPaymentPct(null, 0)).toMatchObject({ pct: 0, source: 'shop' });
  });
  it.each([
    ['over 100', 150],
    ['negative', -5],
    ['not a number', 'abc'],
    ['NaN', Number.NaN],
  ])('an invalid product value (%s) is ignored AND reported', (_l, v) => {
    expect(effectiveDownPaymentPct(v as any, 30)).toEqual({ pct: 30, source: 'shop', invalid: ['product'] });
  });
  it('a missing value is not reported as invalid', () => {
    expect(effectiveDownPaymentPct(null, undefined).invalid).toEqual([]);
    expect(effectiveDownPaymentPct('', null).invalid).toEqual([]);
  });
  it('an invalid shop value falls through to 25 % and is reported', () => {
    expect(effectiveDownPaymentPct(null, 400)).toEqual({ pct: 25, source: 'default', invalid: ['shop'] });
  });
  it('shop-level % for catalogue copy', () => {
    expect([shopDownPaymentPct(0), shopDownPaymentPct(30), shopDownPaymentPct(null), shopDownPaymentPct(-1)]).toEqual([0, 30, 25, 25]);
  });
});

describe('rentalTerms (what create() stores and the quote shows)', () => {
  it('deposit is separate: never part of the down payment', () => {
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
  it('fee and deposit rules are unchanged: no rental price → 10 % of retail; no deposit → 0', () => {
    const t = rentalTerms({ basePrice: '900000' }, null);
    expect([t.rentalFee, t.deposit, t.downPayment, t.usable]).toEqual([90000, 0, 22500, true]);
  });
  it('no usable fee (no rental price, no retail price) → usable=false (never NaN amounts)', () => {
    expect(rentalTerms({ basePrice: null }, null).usable).toBe(false);
    expect(rentalTerms({ rentalPricePerDay: '-5' }, null).usable).toBe(false);
  });
});

// ---------------------------------------------------------------- service
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

function makeService(product: any, policy: any) {
  const prisma: any = autoPrisma({
    product: { findFirst: jest.fn().mockResolvedValue(product) },
    rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
  });
  const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
  return { svc, prisma };
}

describe('GET /rentals/quote/:productId', () => {
  const handler = RentalsController.prototype.getQuote;

  it('is @Public, throttled at 60/min, and still behind the rentals module', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
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
    // reads only the price columns it needs
    expect(Object.keys(prisma.product.findFirst.mock.calls[0][0].select).sort()).toEqual(
      ['basePrice', 'rentalDepositAmount', 'rentalDownPaymentPct', 'rentalPricePerDay'],
    );
  });

  it('unknown / hidden / purchase-only product → 404', async () => {
    const { svc } = makeService(null, null);
    await expect(svc.getQuote('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns six finite, non-negative amounts only: no ids, no policy internals, no source', async () => {
    const { svc } = makeService(GOWN, { defaultDownPaymentPct: 30 });
    const q: any = await svc.getQuote('p1');
    expect(Object.keys(q).sort()).toEqual(['deposit', 'downPayment', 'downPaymentPct', 'remaining', 'rentalFee', 'total']);
    for (const v of Object.values(q)) expect(Number.isFinite(v) && (v as number) >= 0).toBe(true);
    expect(q).toEqual({ rentalFee: 140000, deposit: 350000, downPaymentPct: 30, downPayment: 42000, total: 490000, remaining: 448000 });
  });

  it('unusable amounts → 422 RENTAL_TERMS_UNAVAILABLE, never a NaN quote', async () => {
    const { svc } = makeService({ ...GOWN, rentalPricePerDay: null, basePrice: null }, null);
    const err: any = await svc.getQuote('p-nofee').catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse().code).toBe(RENTAL_TERMS_UNAVAILABLE);
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

describe('invalid financial configuration is logged (ids and value only), once', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  it('an invalid product % → one warning naming tenant + product, then the shop default is used', async () => {
    const { svc } = makeService({ ...GOWN, rentalDownPaymentPct: 150 }, { defaultDownPaymentPct: 30 });
    const q = await svc.getQuote('p-warn-1');
    await svc.getQuote('p-warn-1');
    expect(q.downPaymentPct).toBe(30);
    const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[RENTAL_TERMS]'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/invalid product down-payment % ignored tenant=tenant-a product=p-warn-1 value="150" → using the shop default \(30%\)/);
    expect(msgs[0]).not.toMatch(/@|password|token|phone/i);
  });

  it('an invalid shop default → a shop-level warning (no product id) and the 25 % fallback', async () => {
    const { svc } = makeService(GOWN, { defaultDownPaymentPct: 400 });
    expect((await svc.getQuote('p-warn-2')).downPaymentPct).toBe(25);
    const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[RENTAL_TERMS]'));
    expect(msgs.some((m) => /invalid shop down-payment % ignored tenant=tenant-a value="400" → using the 25% fallback/.test(m))).toBe(true);
    expect(msgs.some((m) => m.includes('product=p-warn-2'))).toBe(false);
  });

  it('valid configuration logs nothing', async () => {
    const { svc } = makeService({ ...GOWN, rentalDownPaymentPct: 0 }, { defaultDownPaymentPct: 30 });
    await svc.getQuote('p-warn-3');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[RENTAL_TERMS]'))).toHaveLength(0);
  });
});

describe('GET /rentals/terms-summary (the "How it works" step)', () => {
  it('is @Public, throttled, behind the rentals module, and returns only downPaymentRequired', async () => {
    const handler = RentalsController.prototype.getTermsSummary;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(60);
    const { svc, prisma } = makeService(null, { defaultDownPaymentPct: 30 });
    expect(await svc.getTermsSummary()).toEqual({ downPaymentRequired: true });
    expect(prisma.rentalPolicy.findFirst.mock.calls[0][0]).toEqual({ where: { tenantId: T }, select: { defaultDownPaymentPct: true } });
  });
  it.each([
    [0, false],
    [30, true],
    [null, true],
    [400, true],
  ])('shop default %p → downPaymentRequired %p', async (pct, req) => {
    const { svc } = makeService(null, pct === null ? null : { defaultDownPaymentPct: pct });
    expect(await svc.getTermsSummary()).toEqual({ downPaymentRequired: req });
  });
});

// ---------------------------------------------------------------- booking
function bookingService(product: any, policy: any) {
  const created: any[] = [];
  const tx: any = autoPrisma({
    $executeRaw: jest.fn(),
    rentalOrder: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }: any) => { created.push(data); return data; }),
    },
  });
  const user = { id: 'u1', firstName: 'A', lastName: 'B', phone: '0712', email: 'a@b.c', addresses: [{ id: 'a1' }] };
  const prisma: any = autoPrisma({
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    product: {
      findUnique: jest.fn().mockResolvedValue({ id: 'p1', tenantId: T, availabilityMode: 'RENTAL_ONLY', isActive: true, deletedAt: null, bufferDaysOverride: null, ...product }),
      findFirst: jest.fn().mockResolvedValue({ id: 'p1', ...product }),
    },
    productVariant: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', productId: 'p1', tenantId: T, isActive: true }) },
    rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
    rentalOrder: { count: jest.fn().mockResolvedValue(0) },
    customerIDDocument: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  });
  const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
  return { svc, created, prisma };
}
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const booking = (extra: Record<string, unknown> = {}) =>
  ({ productId: 'p1', variantId: 'v1', startDate: day(20), returnDate: day(22), pickupDate: day(20), ...extra }) as any;

describe('create() computes and stores its own amounts = the quote', () => {
  it.each([
    ['product override', { ...GOWN, rentalDownPaymentPct: 40 }, { defaultDownPaymentPct: 30 }],
    ['shop default', GOWN, { defaultDownPaymentPct: 30 }],
    ['product 0 %', { ...GOWN, rentalDownPaymentPct: 0 }, { defaultDownPaymentPct: 30 }],
    ['missing configuration', GOWN, null],
  ])('%s: stored downPaymentAmount / fee / deposit = the quote', async (_l, product, policy) => {
    const quote = await makeService(product, policy).svc.getQuote('p1');
    const { svc, created } = bookingService(product, policy);
    await svc.create('u1', booking({ quotedRentalFee: quote.rentalFee, quotedDeposit: quote.deposit, quotedDownPayment: quote.downPayment }));
    expect(created).toHaveLength(1);
    expect(Number(created[0].downPaymentAmount)).toBe(quote.downPayment);
    expect(Number(created[0].totalRentalPrice)).toBe(quote.rentalFee);
    expect(Number(created[0].damageDeposit)).toBe(quote.deposit);
  });

  it('the stored amount is the SERVER value, never the client-sent one', async () => {
    const { svc, created } = bookingService(GOWN, { defaultDownPaymentPct: 30 });
    await svc.create('u1', booking());
    expect(Number(created[0].downPaymentAmount)).toBe(42000);
  });
});

describe('a policy or price change between quote and submission', () => {
  it('shop default 25 → 30 % after the page loaded: 409 RENTAL_TERMS_CHANGED with the new quote, nothing stored', async () => {
    const shown = await makeService(GOWN, { defaultDownPaymentPct: 25 }).svc.getQuote('p1');
    const { svc, created } = bookingService(GOWN, { defaultDownPaymentPct: 30 });
    const err: any = await svc
      .create('u1', booking({ quotedRentalFee: shown.rentalFee, quotedDeposit: shown.deposit, quotedDownPayment: shown.downPayment }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      code: RENTAL_TERMS_CHANGED,
      current: { downPaymentPct: 30, downPayment: 42000, rentalFee: 140000, deposit: 350000, total: 490000, remaining: 448000 },
    });
    expect(created).toHaveLength(0);
  });

  it.each([
    ['rental fee', { quotedRentalFee: 130000 }],
    ['deposit', { quotedDeposit: 300000 }],
    ['down payment', { quotedDownPayment: 35000 }],
  ])('a changed %s alone is enough to refuse', async (_l, q) => {
    const { svc, created } = bookingService(GOWN, { defaultDownPaymentPct: 30 });
    await expect(svc.create('u1', booking(q))).rejects.toBeInstanceOf(ConflictException);
    expect(created).toHaveLength(0);
  });

  it('re-submitting with the new amounts books', async () => {
    const { svc, created } = bookingService(GOWN, { defaultDownPaymentPct: 30 });
    await svc.create('u1', booking({ quotedRentalFee: 140000, quotedDeposit: 350000, quotedDownPayment: 42000 }));
    expect(created).toHaveLength(1);
  });

  it('no quoted amounts (old client, or the quote could not be loaded) → books on the server terms', async () => {
    const { svc, created } = bookingService(GOWN, { defaultDownPaymentPct: 30 });
    await svc.create('u1', booking());
    expect(created).toHaveLength(1);
  });

  it('unusable amounts → 422 before anything is stored', async () => {
    const { svc, created } = bookingService({ ...GOWN, rentalPricePerDay: null, basePrice: null }, null);
    await expect(svc.create('u1', booking())).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(created).toHaveLength(0);
  });

  it('quotedTermsDiffer compares to the cent', () => {
    const t = rentalTerms(GOWN, { defaultDownPaymentPct: 25 });
    expect(quotedTermsDiffer({ quotedDownPayment: 35000.004 }, t)).toBe(false);
    expect(quotedTermsDiffer({ quotedDownPayment: 35000.01 }, t)).toBe(true);
    expect(quotedTermsDiffer({}, t)).toBe(false);
  });
});

describe('CreateRentalDto: quoted amounts are validated', () => {
  // Same options as the global pipe in main.ts (incl. implicit conversion).
  const pipe = new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const meta = { type: 'body' as const, metatype: CreateRentalDto };
  const base = { productId: 'p1', variantId: 'v1', startDate: '2026-12-10', returnDate: '2026-12-12', pickupDate: '2026-12-10' };
  it('a numeric string is converted to its number (global implicit conversion), then validated like one', async () => {
    const dto: any = await pipe.transform({ ...base, quotedDownPayment: '35000' }, meta);
    expect(dto.quotedDownPayment).toBe(35000);
    await expect(pipe.transform({ ...base, quotedDownPayment: '-5' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts valid amounts (and their absence)', async () => {
    await expect(pipe.transform(base, meta)).resolves.toBeTruthy();
    await expect(pipe.transform({ ...base, quotedRentalFee: 140000, quotedDeposit: 0, quotedDownPayment: 35000.5 }, meta)).resolves.toBeTruthy();
  });
  it.each([
    ['negative', { quotedDownPayment: -1 }],
    ['a non-numeric string', { quotedDownPayment: 'abc' }],
    ['NaN', { quotedDownPayment: Number.NaN }],
    ['Infinity', { quotedRentalFee: Number.POSITIVE_INFINITY }],
    ['3 decimals', { quotedDeposit: 1.001 }],
    ['absurdly large', { quotedRentalFee: 1e15 }],
    ['an unknown field', { quotedDownPaymentPct: 25 }],
  ])('rejects %s', async (_l, extra) => {
    await expect(pipe.transform({ ...base, ...extra }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------- with PR #12 (integration)
describe('with PR #12: quote, stored booking, remaining fee and deposit agree (whole TZS, rounded up)', () => {
  const FRACTIONAL = { rentalPricePerDay: '250', basePrice: '500', rentalDepositAmount: '50', rentalDownPaymentPct: 25 };
  it('fee 250 at 25 % → down payment 63 (not 62.5), remaining 237, deposit 50, total 300', async () => {
    const q = await makeService(FRACTIONAL, null).svc.getQuote('p-frac');
    expect(q).toEqual({ rentalFee: 250, deposit: 50, downPaymentPct: 25, downPayment: 63, total: 300, remaining: 237 });
  });
  it('the booking stores the same 63 / 250 / 50, and the quoted 63 is accepted', async () => {
    const { svc, created } = bookingService(FRACTIONAL, null);
    await svc.create('u1', booking({ quotedRentalFee: 250, quotedDeposit: 50, quotedDownPayment: 63 }));
    expect([Number(created[0].downPaymentAmount), Number(created[0].totalRentalPrice), Number(created[0].damageDeposit)]).toEqual([63, 250, 50]);
  });
  it('a page still showing the unrounded 62.5 is refused (terms changed), so nobody books on the old maths', async () => {
    const { svc, created } = bookingService(FRACTIONAL, null);
    const err: any = await svc.create('u1', booking({ quotedRentalFee: 250, quotedDeposit: 50, quotedDownPayment: 62.5 })).catch((e) => e);
    expect(err.getResponse().code).toBe(RENTAL_TERMS_CHANGED);
    expect(created).toHaveLength(0);
  });
  it.each([
    ['30 % shop default on 70.35 → 22 (21.105 rounded up)', { ...FRACTIONAL, rentalPricePerDay: '70.35', rentalDownPaymentPct: null }, { defaultDownPaymentPct: 30 }, 22],
    ['0 % → 0', { ...FRACTIONAL, rentalDownPaymentPct: 0 }, null, 0],
    ['100 % → the whole fee, never more', { ...FRACTIONAL, rentalDownPaymentPct: 100 }, null, 250],
    ['bouquet 400,000 at 25 % → 100,000', { ...FRACTIONAL, rentalPricePerDay: '400000', rentalDepositAmount: '200000' }, null, 100000],
  ])('%s', async (_l, product, policy, dp) => {
    const q = await makeService(product, policy).svc.getQuote('p-r');
    expect(q.downPayment).toBe(dp);
    expect(q.remaining).toBe(q.total - dp);
    expect(Number.isInteger(q.downPayment)).toBe(true);
  });
});
