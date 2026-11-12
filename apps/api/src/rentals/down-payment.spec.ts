import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { computeDownPayment } from './down-payment';
import { PaymentSettlementService } from '../payments/payment-settlement.service';

/**
 * Design branch (owner-approved local design, 2026-11-12): the 25% rental
 * down payment is rounded UP to a whole shilling, computed once on the
 * server at booking and stored; everything else uses the stored value.
 */
describe('computeDownPayment: fixed cases', () => {
  it.each([
    // fee, pct, expected               why
    [250, 25, 63],          // 62.50 -> 63 (production bouquet today)
    [249, 25, 63],          // 62.25 -> 63 (Math.round gave 62: under-collected)
    [248, 25, 62],          // exact
    [24_000, 25, 6_000],    // multiple of 400 -> round hundred
    [25_000, 25, 6_250],    // multiple of 4 -> whole, no rounding
    [150_000, 25, 37_500],  // typical gown
    [1, 25, 1],             // 0.25 -> 1, but never more than the fee
    [3, 33, 1],             // 0.99 -> 1
    [70.35, 25, 18],        // 17.5875 -> 18 (no float drift)
    [100, 100, 100],        // full payment up front
    [99.99, 100, 100],      // capped at the whole-shilling fee
    [500, 30, 150],         // non-default percentage
  ])('fee %p at %p%% -> %p', (fee, pct, expected) => {
    expect(computeDownPayment(fee, pct)).toBe(expected);
  });

  it('no fee, zero / negative / junk inputs give 0; pct above 100 is treated as 100', () => {
    for (const [f, p] of [[0, 25], [-10, 25], [NaN, 25], [250, 0], [250, -5], [250, NaN]] as const) {
      expect(computeDownPayment(f, p)).toBe(0);
    }
    expect(computeDownPayment(250, 150)).toBe(250);
  });
});

describe('computeDownPayment: properties over a grid of fees', () => {
  const fees: number[] = [];
  for (let f = 1; f <= 2_000; f++) fees.push(f);
  fees.push(24_999, 25_001, 149_999, 1_234_567, 99_999_999);
  const pcts = [10, 20, 25, 30, 33, 50, 100];

  it('always a whole shilling, never below the exact amount, less than 1 TZS above it, never above the fee', () => {
    for (const fee of fees) {
      for (const pct of pcts) {
        const dp = computeDownPayment(fee, pct);
        const exact = (fee * pct) / 100;
        expect(Number.isInteger(dp)).toBe(true);
        expect(dp).toBeGreaterThanOrEqual(exact - 1e-9);
        expect(dp - exact).toBeLessThan(1);
        expect(dp).toBeLessThanOrEqual(Math.ceil(fee));
      }
    }
  });

  it('balance = total - down payment is whole, so the shown amounts always add up', () => {
    for (const fee of [249, 250, 25_000, 150_000]) {
      const deposit = 50;
      const total = fee + deposit;
      const dp = computeDownPayment(fee, 25);
      expect(Number.isInteger(total - dp)).toBe(true);
      expect(dp + (total - dp)).toBe(total); // no overpayment: total due unchanged
    }
  });
});

describe('one rule everywhere (after PR #3: the storefront displays the server quote)', () => {
  const sfRoot = join(__dirname, '..', '..', '..', 'storefront');
  it('there is no storefront copy of the rule any more', () => {
    expect(existsSync(join(sfRoot, 'lib', 'down-payment.ts'))).toBe(false);
  });

  it('booking and quote both use rentalTerms(), which calls computeDownPayment(); no other rounding', () => {
    const terms = readFileSync(join(__dirname, 'rental-terms.ts'), 'utf8');
    expect(terms).toMatch(/const downPayment = computeDownPayment\(rentalFee, pct\);/);
    expect(terms).not.toMatch(/rentalFee \* \(pct \/ 100\)/);
    const svc = readFileSync(join(__dirname, 'rentals.service.ts'), 'utf8');
    expect(svc).toMatch(/const downPaymentAmount = terms\.downPayment;/);
    expect(svc).not.toMatch(/downPaymentPct \/ 100/);
    for (const f of [['app', 'rentals', '[slug]', 'page.tsx'], ['app', 'products', '[slug]', 'page.tsx'], ['lib', 'rental-ui.ts']]) {
      const src = readFileSync(join(sfRoot, ...f), 'utf8');
      expect([f.join('/'), /Math\.(round|ceil)\([^)]*(fee|Fee|pct|Pct)/.test(src), /computeDownPayment/.test(src)]).toEqual([f.join('/'), false, false]);
    }
  });
});

describe('settlement with the stored whole-shilling amount (partial payments)', () => {
  const makePrisma = (paid: number, stored: number, status = 'ID_VERIFIED') => ({
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: paid } })) },
    rentalOrder: {
      findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'R1', status, userId: 'u1', downPaymentAmount: stored })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    // National ID (PR #16): settlement confirms only a customer with an approved ID.
    customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'doc1' })) },
  });

  it.each([
    [63, 63, true],   // new booking: exactly the stored down payment
    [62, 63, false],  // one shilling short: stays ID_VERIFIED
    [100, 63, true],  // more than the down payment (towards the balance)
  ])('paid %p against stored %p -> advances: %p', async (paid, stored, advances) => {
    const prisma: any = makePrisma(paid, stored);
    await new PaymentSettlementService(prisma).updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany.mock.calls.length > 0).toBe(advances);
  });

  it('an EXISTING booking keeps its stored fractional amount and rule (no retroactive change)', async () => {
    const short: any = makePrisma(62, 62.5);
    await new PaymentSettlementService(short).updateRentalPaymentStatus('r1', 't1');
    expect(short.rentalOrder.updateMany).not.toHaveBeenCalled();
    const ok: any = makePrisma(63, 62.5);
    await new PaymentSettlementService(ok).updateRentalPaymentStatus('r1', 't1');
    expect(ok.rentalOrder.updateMany).toHaveBeenCalled();
  });
});

describe('cancellations, refunds, deposits and the payment cap', () => {
  const makePrisma = (paid: number, stored: number, status: string) => ({
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: paid } })) },
    rentalOrder: {
      findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'R1', status, userId: 'u1', downPaymentAmount: stored })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    // National ID (PR #16): settlement confirms only a customer with an approved ID.
    customerIDDocument: { findFirst: jest.fn(async () => ({ id: 'doc1' })) },
  });

  it('a CANCELLED booking never advances, even if enough was paid; its stored amount is untouched', async () => {
    const prisma: any = makePrisma(63, 63, 'CANCELLED');
    await new PaymentSettlementService(prisma).updateRentalPaymentStatus('r1', 't1');
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
    const svc = readFileSync(join(__dirname, 'rentals.service.ts'), 'utf8');
    // no cancellation / status / reschedule path rewrites the stored down payment
    expect((svc.match(/downPaymentAmount/g) ?? []).length).toBe(2); // computed once + stored once, in create()
  });

  it('only COMPLETED payments count towards the down payment (refunded or pending ones never do)', async () => {
    const prisma: any = makePrisma(63, 63, 'ID_VERIFIED');
    await new PaymentSettlementService(prisma).updateRentalPaymentStatus('r1', 't1');
    expect(prisma.payment.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ rentalOrderId: 'r1', status: 'COMPLETED' }) }));
  });

  it('the refundable deposit stays separate: the down payment is on the rental fee only', () => {
    const terms = readFileSync(join(__dirname, 'rental-terms.ts'), 'utf8');
    expect(terms).toMatch(/const downPayment = computeDownPayment\(rentalFee, pct\);/);
    expect(terms).toMatch(/const total = rentalFee \+ deposit;/);
    expect(computeDownPayment(250, 25)).toBe(63); // a 50 deposit changes nothing
  });

  it('the payment cap is unchanged (fee + deposit + late fee): paying the down payment leaves an exact whole balance', () => {
    const pay = readFileSync(join(__dirname, '..', 'payments', 'payments.service.ts'), 'utf8');
    expect(pay).toMatch(/Number\(rental\.totalRentalPrice\) \+\s*Number\(rental\.damageDeposit \?\? 0\) \+\s*Number\(rental\.lateFee \?\? 0\)/);
    expect(pay).not.toMatch(/downPaymentAmount/);
    const fee = 250, deposit = 50;
    const dp = computeDownPayment(fee, 25);
    expect(fee + deposit - dp).toBe(237); // what is left to pay after the down payment
  });

  it('there is ONE place that creates a booking, and it uses computeDownPayment (future staff/POS bookings must reuse it)', () => {
    const { execSync } = require('child_process');
    const hits: string = execSync('git grep -l "rentalOrder.create(" -- "*.ts"', { cwd: join(__dirname, '..'), encoding: 'utf8' });
    const files = hits.split('\n').filter((f: string) => f && !f.endsWith('.spec.ts'));
    expect(files).toEqual(['rentals/rentals.service.ts']);
  });

  it('admin screens show the STORED down payment, never a recomputed one', () => {
    for (const rel of ['components/rental/OverdueRentals.tsx', 'components/rental/UpcomingPickups.tsx']) {
      const src = readFileSync(join(__dirname, '..', '..', '..', 'admin', rel), 'utf8');
      expect(src).toMatch(/Number\(rental\.downPaymentAmount\)/);
      expect(src).not.toMatch(/\* ?0\.25|\/ ?100\)/);
    }
  });
});
