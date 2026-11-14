import { readFileSync } from 'fs';
import { join } from 'path';
import { assertNotDeductionDecider, assertPayerIndependent } from './separation';

// Round 25E D: separation of duties for refunds (G2 approver ≠ payer, G3 deduction decider).
const audit = () => ({ log: jest.fn(async () => undefined) });
const code = async (p: Promise<unknown>) => { try { await p; return 'ALLOWED'; } catch (e: any) { return e.getResponse?.().code ?? String(e); } };

describe('G2: the approver never pays out', () => {
  it('approver = payer → 403 PAYOUT_BY_APPROVER, audited; a different payer → allowed', async () => {
    const a = audit();
    expect(await code(assertPayerIndependent({ id: 'q1', requestedById: 'u1', approvedById: 'u2' }, 'u2', a))).toBe('PAYOUT_BY_APPROVER');
    expect(a.log).toHaveBeenCalledWith('REFUND_PAYOUT_DENIED', 'RefundRequest', 'q1', { reason: 'PAYOUT_BY_APPROVER' });
    expect(await code(assertPayerIndependent({ id: 'q1', requestedById: 'u1', approvedById: 'u2' }, 'u3', audit()))).toBe('ALLOWED');
  });
});

describe('G3: whoever decided a deposit deduction neither approves nor pays the refund that keeps it', () => {
  const db = (resolvers: string[]) => ({ rentalDiscrepancy: { findMany: jest.fn(async () => resolvers.map((r) => ({ resolvedById: r }))) } });
  const keep = { id: 'q2', kind: 'DEPOSIT_RETURN', rentalOrderId: 'r1', retainedAmount: 50000 };
  it('the decider → 403 DEDUCTION_DECIDER at approval and at payout; anyone else → allowed', async () => {
    expect(await code(assertNotDeductionDecider(db(['rev']), 't1', keep, 'rev', 'approve', audit()))).toBe('DEDUCTION_DECIDER');
    expect(await code(assertNotDeductionDecider(db(['rev']), 't1', keep, 'rev', 'pay', audit()))).toBe('DEDUCTION_DECIDER');
    expect(await code(assertNotDeductionDecider(db(['rev']), 't1', keep, 'fin', 'pay', audit()))).toBe('ALLOWED');
  });
  it('nothing kept, or not a deposit return → no restriction (and no lookup)', async () => {
    const d = db(['rev']);
    expect(await code(assertNotDeductionDecider(d, 't1', { ...keep, retainedAmount: 0 }, 'rev', 'approve', audit()))).toBe('ALLOWED');
    expect(await code(assertNotDeductionDecider(d, 't1', { ...keep, kind: 'CANCELLATION' }, 'rev', 'pay', audit()))).toBe('ALLOWED');
    expect(d.rentalDiscrepancy.findMany).not.toHaveBeenCalled();
  });
});

describe('wiring + database backstop', () => {
  const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
  it('both payout paths call the G2 check; the rental path also the G3 checks', () => {
    expect(read('../rentals/rental-money.service.ts')).toMatch(/assertPayerIndependent\(req as any, actor\.id/);
    expect((read('../rentals/rental-money.service.ts').match(/assertNotDeductionDecider\(/g) ?? []).length).toBe(2);
    expect(read('./refund-requests.service.ts')).toMatch(/assertPayerIndependent\(r as any, actor\.id/);
  });
  it('migration 20261117120000 refuses self-approval, payout by requester or approver, and the deduction decider', () => {
    const m = read('../../../../packages/database/prisma/migrations/20261117120000_refund_separation/migration.sql');
    expect(m).toMatch(/"approvedById" = NEW\."requestedById"/);
    expect(m).toMatch(/"paidById" = NEW\."requestedById" OR NEW\."paidById" = NEW\."approvedById"/);
    expect(m).toMatch(/RESOLVED_DEDUCTED/);
    expect(m).toMatch(/SECURITY DEFINER SET search_path/);
  });
});
