import { readFileSync } from 'fs';
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

describe('one rule everywhere', () => {
  const block = (src: string) => src.slice(src.indexOf('// --- shared:computeDownPayment:start'), src.indexOf('// --- shared:computeDownPayment:end')).replace(/\r\n/g, '\n');
  const api = readFileSync(join(__dirname, 'down-payment.ts'), 'utf8');
  const sf = readFileSync(join(__dirname, '..', '..', '..', 'storefront', 'lib', 'down-payment.ts'), 'utf8');

  it('the storefront preview copy is identical to the API rule', () => {
    expect(block(sf).length).toBeGreaterThan(100);
    expect(block(sf)).toBe(block(api));
  });

  it('booking stores computeDownPayment(); the booking page previews with the same function; no other rounding', () => {
    const svc = readFileSync(join(__dirname, 'rentals.service.ts'), 'utf8');
    expect(svc).toMatch(/const downPaymentAmount = computeDownPayment\(totalRentalPrice, downPaymentPct\);/);
    expect(svc).not.toMatch(/totalRentalPrice \* \(downPaymentPct \/ 100\)/);
    const page = readFileSync(join(__dirname, '..', '..', '..', 'storefront', 'app', 'rentals', '[slug]', 'page.tsx'), 'utf8');
    expect(page).toMatch(/const downPayment = computeDownPayment\(rentalFee, downPaymentPercent\);/);
    expect(page).not.toMatch(/Math\.round\(rentalFee/);
  });

  it('settlement compares against the STORED amount and never recomputes or re-rounds it', () => {
    const s = readFileSync(join(__dirname, '..', 'payments', 'payment-settlement.service.ts'), 'utf8');
    expect(s).toMatch(/const downPaymentDue = Number\(rental\.downPaymentAmount\);/);
    expect(s).not.toMatch(/computeDownPayment|Math\.(ceil|round|floor)\(.*downPayment/);
  });
});

describe('settlement with the stored whole-shilling amount (partial payments)', () => {
  const makePrisma = (paid: number, stored: number, status = 'ID_VERIFIED') => ({
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: paid } })) },
    rentalOrder: {
      findFirst: jest.fn(async () => ({ id: 'r1', rentalNumber: 'R1', status, downPaymentAmount: stored })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
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
