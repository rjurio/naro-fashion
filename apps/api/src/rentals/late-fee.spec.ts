import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { lateDays, lateFeeFor, lateFeeSentence, lateFeeTerms, storedLateFeeTerms } from './late-fee';
import { rentalBalances } from './rental-ledger';
import { RentalMoneyService } from './rental-money.service';

// Late-fee rules LF-2026-11 (owner round 25 C, for NEW bookings).

describe('lateFeeTerms: precedence', () => {
  it('product % of the agreed rental fee per day, capped at 100 % of the fee by default', () => {
    const t = lateFeeTerms({ rentalFee: 400000, productPct: 10 });
    expect(t).toMatchObject({ basis: 'PERCENT', pct: 10, perDay: 40000, capPct: 100, capAmount: 400000, source: 'PRODUCT' });
  });

  it('an explicit 0 % means NO late fee — never replaced by any fixed daily charge', () => {
    const t = lateFeeTerms({ rentalFee: 400000, productPct: 0, shopDefaultPct: 10, freeRentalPerDay: 10000 });
    expect(t).toMatchObject({ basis: 'NONE', perDay: 0, capAmount: null });
    expect(lateFeeFor(t, 30)).toBe(0);
  });

  it('no product % → the shop default %; nothing valid → 10 %', () => {
    expect(lateFeeTerms({ rentalFee: 100000, productPct: null, shopDefaultPct: 15 })).toMatchObject({ pct: 15, perDay: 15000, source: 'SHOP_DEFAULT' });
    expect(lateFeeTerms({ rentalFee: 100000, productPct: 150, shopDefaultPct: -1 })).toMatchObject({ pct: 10, perDay: 10000 });
  });

  it('a FREE rental has no late fee unless the shop sets an explicit free-rental daily charge (uncapped, explicit)', () => {
    expect(lateFeeTerms({ rentalFee: 0, productPct: 10 })).toMatchObject({ basis: 'NONE', perDay: 0 });
    expect(lateFeeTerms({ rentalFee: 0, freeRentalPerDay: 5000 })).toMatchObject({ basis: 'FIXED', perDay: 5000, capAmount: null, source: 'FREE_RENTAL_POLICY' });
  });

  it('a shop cap below 100 % applies; an invalid cap falls back to 100 %', () => {
    expect(lateFeeTerms({ rentalFee: 400000, productPct: 10, capPct: 50 }).capAmount).toBe(200000);
    expect(lateFeeTerms({ rentalFee: 400000, productPct: 10, capPct: 250 }).capAmount).toBe(400000);
  });
});

describe('lateFeeFor: whole late days, capped', () => {
  const t = lateFeeTerms({ rentalFee: 400000, productPct: 10 });
  it.each([[0, 0], [1, 40000], [3, 120000], [10, 400000], [15, 400000]])('%i day(s) late → %i TZS', (d, fee) => expect(lateFeeFor(t, d)).toBe(fee));
  it('the cheapest live product (80,000) reaches the 100 % cap after 10 days, like the dearest', () => {
    const c = lateFeeTerms({ rentalFee: 80000, productPct: 10 });
    expect([lateFeeFor(c, 9), lateFeeFor(c, 10), lateFeeFor(c, 40)]).toEqual([72000, 80000, 80000]);
  });
  it('days are whole Tanzanian calendar days after the agreed return date', () => {
    const agreed = new Date('2027-01-10T20:00:00Z'); // 23:00 EAT on the 10th
    expect(lateDays(agreed, new Date('2027-01-10T21:30:00Z'))).toBe(1); // 00:30 EAT on the 11th
    expect(lateDays(agreed, new Date('2027-01-10T19:00:00Z'))).toBe(0);
  });
});

describe('the ONE calculation is used everywhere', () => {
  const svc = readFileSync(join(__dirname, 'rentals.service.ts'), 'utf8');
  const pos = readFileSync(join(__dirname, 'pos-rentals.service.ts'), 'utf8');
  it('booking stores the terms; quote and booking call the same function', () => {
    expect(svc).toMatch(/lateFeeTerms: agreedLateFee as any/);
    expect((svc.match(/lateFeeTerms\(\{/g) ?? []).length).toBe(2); // create() + getQuote()
  });
  it('the return uses the STORED terms (legacy rule only for bookings made before)', () => {
    const i = svc.indexOf('const agreed = storedLateFeeTerms((rental as any).lateFeeTerms);');
    expect(i).toBeGreaterThan(-1);
    expect(svc.slice(i, i + 400)).toMatch(/lateFeeFor\(agreed, lateDays\(rental\.returnDate, returnedAt\)\)/);
  });
  it('the overdue list shows the accrued fee from the same terms', () => {
    expect(svc).toMatch(/lateFeeAccrued: agreed \? lateFeeFor\(agreed, days\) : null/);
  });
  it('the POS quote and the agreement read the same terms (no own formula)', () => {
    expect(pos).toMatch(/terms\.lateFee \? Number\(terms\.lateFee\.perDay\)/);
    expect(pos).not.toMatch(/latePenaltyPercent\)\) \/ 100/);
    expect(pos).toMatch(/lateFeeText:/);
  });
  it('stored terms are recognised; anything else is "legacy"', () => {
    expect(storedLateFeeTerms(lateFeeTerms({ rentalFee: 1000, productPct: 10 }))).not.toBeNull();
    expect(storedLateFeeTerms(null)).toBeNull();
    expect(storedLateFeeTerms({ foo: 1 })).toBeNull();
  });
});

describe('waivers reduce what is due, never automatically', () => {
  it('ledger: an approved waiver lowers the late fee due', () => {
    const b = rentalBalances({ totalRentalPrice: 400000, damageDeposit: 0, lateFee: 120000, lateFeeWaived: 40000, downPaymentAmount: 100000 }, []);
    expect(b.due.LATE_FEE).toBe(80000);
  });
  it('the requester can never approve their own waiver (403, audited)', async () => {
    const s: any = Object.create(RentalMoneyService.prototype);
    s.tenantContext = { requireId: 't1' };
    s.audit = { log: jest.fn() };
    s.prisma = { rentalLateFeeWaiver: { findFirst: jest.fn().mockResolvedValue({ id: 'w1', rentalOrderId: 'r1', amount: 1000, requestedById: 'cashier' }) }, $transaction: jest.fn() };
    const e: any = await s.approveLateFeeWaiver('w1', {}, { id: 'cashier' }).catch((x: any) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(s.audit.log).toHaveBeenCalledWith('LATE_FEE_WAIVER_DENIED', 'RentalLateFeeWaiver', 'w1', { reason: 'SELF_APPROVAL' });
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('customer wording comes from the terms (EN / SW)', () => {
  it('percent with cap; none', () => {
    const t = lateFeeTerms({ rentalFee: 400000, productPct: 10 });
    expect(lateFeeSentence(t, 'en')).toBe('Late fee: 10% (TZS 40,000) for each full day after the return date, up to TZS 400,000 in total.');
    expect(lateFeeSentence(t, 'sw')).toBe('Ada ya kuchelewa: 10% (TZS 40,000) kwa kila siku kamili baada ya tarehe ya kurudisha, isiyozidi TZS 400,000 kwa jumla.');
    expect(lateFeeSentence(lateFeeTerms({ rentalFee: 400000, productPct: 0 }), 'en')).toBe('No late fee applies to this item.');
  });
});
