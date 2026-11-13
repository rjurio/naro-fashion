import * as fs from 'fs';
import * as path from 'path';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

// Round 25F E: a payment reversal is requested by one person and executed
// only when a DIFFERENT holder of payments:reverse approves it; manual
// confirmations get an independent after-the-fact review.
const T = 't1';
function world(over: any = {}) {
  const payment: any = {
    id: 'pay-9', tenantId: T, orderId: 'o9', layawayId: null, rentalOrderId: null, amount: 1000, method: 'CARD', status: 'COMPLETED', transactionRef: 'RRN1234',
    gatewayResponse: { verification: { method: 'MANUAL_TERMINAL', evidence: 'manual', providerVerified: false, confirmedByAdminId: 'cashier', confirmedAt: '2026-11-13T08:00:00Z' } },
    ...over,
  };
  const requests: any[] = [];
  const reviews: any[] = [];
  const audit = { log: jest.fn(async () => undefined) };
  const refunds = { refundedRows: over.__refundedRows ?? 0, openRequests: over.__openRefundRequests ?? 0 };
  delete payment.__refundedRows; delete payment.__openRefundRequests;
  const tx: any = {
    $executeRaw: jest.fn(async () => 1),
    refundRequest: { count: jest.fn(async () => refunds.openRequests) },
    payment: {
      count: jest.fn(async () => refunds.refundedRows),
      findFirst: jest.fn(async () => ({ ...payment })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && payment.status !== where.status) return { count: 0 };
        Object.assign(payment, data);
        return { count: 1 };
      }),
    },
    order: { updateMany: jest.fn(async () => ({ count: 1 })) },
    layaway: { updateMany: jest.fn(async () => ({ count: 1 })) },
    paymentReversalRequest: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const r of requests) {
          if (where.id && r.id !== where.id) continue;
          if (where.paymentId && r.paymentId !== where.paymentId) continue;
          if (where.status && r.status !== where.status) continue;
          if (where.expiresAt?.lte && !(r.expiresAt <= where.expiresAt.lte)) continue;
          if (where.expiresAt?.gt && !(r.expiresAt > where.expiresAt.gt)) continue;
          Object.assign(r, data); n += 1;
        }
        return { count: n };
      }),
      findFirst: jest.fn(async ({ where }: any) => requests.find((r) => (!where.id || r.id === where.id) && (!where.paymentId || r.paymentId === where.paymentId) && (!where.status || r.status === where.status)) ?? null),
      create: jest.fn(async ({ data }: any) => { const r = { id: `rv${requests.length + 1}`, status: 'REQUESTED', ...data }; requests.push(r); return r; }),
    },
  };
  const prisma: any = {
    ...tx,
    payment: { ...tx.payment, findMany: jest.fn(async () => [{ ...payment }]) },
    manualPaymentReview: {
      findMany: jest.fn(async () => reviews),
      create: jest.fn(async ({ data }: any) => {
        if (reviews.some((r) => r.paymentId === data.paymentId)) { const e: any = new Error('unique'); e.code = 'P2002'; throw e; }
        const r = { id: `mr${reviews.length + 1}`, ...data }; reviews.push(r); return r;
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new PosService(prisma, { requireId: T } as any, audit as any);
  return { service, payment, requests, reviews, audit, tx, refunds };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e.getResponse?.().code ?? e.message; } };

describe('payment reversal: request → independent approval → executed once', () => {
  it('the request records who and why, changes no money, and blocks a second open request', async () => {
    const w = world();
    const r: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    expect([r.status, w.payment.status, w.requests[0].requestedById]).toEqual(['PENDING_APPROVAL', 'COMPLETED', 'cashier']);
    expect(await code(w.service.requestReversal('pay-9', 'again, the same payment', 'manager'))).toBe('REVERSAL_ALREADY_REQUESTED');
  });
  it('self-approval → 403 SELF_APPROVAL (audited) — no role bypass; the payment stays COMPLETED', async () => {
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'boss');
    expect(await code(w.service.approveReversal(request.id, undefined, 'boss'))).toBe('SELF_APPROVAL');
    expect(w.payment.status).toBe('COMPLETED');
    expect(w.audit.log).toHaveBeenCalledWith('PAYMENT_REVERSAL_DENIED', 'Payment', 'pay-9', expect.objectContaining({ reason: 'SELF_APPROVAL' }));
  });
  it('another approver executes it (REVERSED, order flagged, requester + approver recorded); a second approval → 409', async () => {
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    const out: any = await w.service.approveReversal(request.id, 'checked the settlement report', 'manager');
    expect([out.status, w.payment.status, w.requests[0].status, w.requests[0].decidedById]).toEqual(['REVERSED', 'REVERSED', 'EXECUTED', 'manager']);
    expect(w.payment.gatewayResponse.reversal).toMatchObject({ requestedByAdminId: 'cashier', approvedByAdminId: 'manager', requestId: request.id });
    expect(w.tx.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o9', tenantId: T }, data: { paymentStatus: 'PAYMENT_REVERSED' } });
    expect(await code(w.service.approveReversal(request.id, undefined, 'manager2'))).toBe('NOT_PENDING');
  });
  it('two approvals at once → exactly one executes', async () => {
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    const out = await Promise.all([code(w.service.approveReversal(request.id, undefined, 'a1')), code(w.service.approveReversal(request.id, undefined, 'a2'))]);
    expect(out.sort()).toEqual(['NOT_PENDING', 'OK']);
    expect(w.tx.order.updateMany).toHaveBeenCalledTimes(1);
  });
  it('an expired request can no longer be approved (409 REVERSAL_EXPIRED); withdraw is the requester\'s, reject someone else\'s', async () => {
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    w.requests[0].expiresAt = new Date(Date.now() - 1000);
    expect(await code(w.service.approveReversal(request.id, undefined, 'manager'))).toBe('REVERSAL_EXPIRED');
    expect([w.requests[0].status, w.payment.status]).toEqual(['EXPIRED', 'COMPLETED']);
    const b: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    expect(await code(w.service.withdrawReversal(b.request.id, 'manager'))).toBe('NOT_REQUESTER');
    expect(await code(w.service.rejectReversal(b.request.id, undefined, 'cashier'))).toBe('SELF_DECISION');
    expect((await w.service.rejectReversal(b.request.id, 'terminal report shows it', 'manager')).status).toBe('REJECTED');
    expect(w.payment.status).toBe('COMPLETED');
  });
  it('an already-reversed or refunded payment, or a sale with a refund requested / paid, is refused (request AND execution)', async () => {
    expect(await code(world({ status: 'REVERSED' }).service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier'))).toMatch(/only a COMPLETED/);
    expect(await code(world({ status: 'REFUNDED' }).service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier'))).toMatch(/only a COMPLETED/);
    expect(await code(world({ __refundedRows: 1 }).service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier'))).toBe('HAS_REFUNDS');
    expect(await code(world({ __openRefundRequests: 1 }).service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier'))).toBe('HAS_REFUNDS');
    // a refund raised AFTER the reversal request blocks the execution too
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'cashier');
    w.refunds.openRequests = 1;
    expect(await code(w.service.approveReversal(request.id, undefined, 'manager'))).toBe('HAS_REFUNDS');
    expect(w.payment.status).toBe('COMPLETED');
    expect(w.tx.order.updateMany).not.toHaveBeenCalled();
    // the refund-target query is tenant-scoped and covers the sale
    expect(w.tx.refundRequest.count.mock.calls[0][0].where).toMatchObject({ tenantId: T, OR: [{ orderId: 'o9' }] });
  });
  it('a SUPER_ADMIN requester is not exempt: same person -> 403 SELF_APPROVAL (the service has no role bypass)', async () => {
    const w = world();
    const { request }: any = await w.service.requestReversal('pay-9', 'Not on terminal settlement report', 'super-1');
    expect(await code(w.service.approveReversal(request.id, undefined, 'super-1'))).toBe('SELF_APPROVAL');
    const src = fs.readFileSync(path.join(__dirname, 'pos.service.ts'), 'utf8');
    const body = src.slice(src.indexOf('async approveReversal('), src.indexOf('async rejectReversal('));
    expect(body).not.toMatch(/SUPER_ADMIN|isPlatformAdmin/);
  });
  it('the one-step reversePayment() is reachable from no route and called by no other source file', () => {
    expect((PosController.prototype as any).reversePayment).toBeUndefined();
    const root = path.join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('pos.service.ts') && /\.reversePayment\(/.test(fs.readFileSync(f, 'utf8'))) offenders.push(f);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
  it('cash, provider-verified and rental payments cannot even be requested', async () => {
    expect(await code(world({ method: 'CASH', gatewayResponse: {} }).service.requestReversal('pay-9', 'wrong change given', 'cashier'))).toMatch(/Only manually confirmed/);
    expect(await code(world({ rentalOrderId: 'r1' }).service.requestReversal('pay-9', 'wrong change given', 'cashier'))).toBe('USE_REFUND_WORKFLOW');
  });
});

describe('manual confirmation review (detection, not blocking)', () => {
  it('lists unreviewed manual confirmations with who confirmed them', async () => {
    const w = world();
    const rows = await w.service.listManualConfirmations('UNREVIEWED');
    expect(rows.map((r) => [r.paymentId, r.confirmedById, r.review])).toEqual([['pay-9', 'cashier', null]]);
  });
  it('the confirmer cannot review their own confirmation (403 SELF_REVIEW); someone else can, once; QUERIED needs a note; no money changes', async () => {
    const w = world();
    expect(await code(w.service.reviewManualConfirmation('pay-9', 'OK', undefined, 'cashier'))).toBe('SELF_REVIEW');
    expect(await code(w.service.reviewManualConfirmation('pay-9', 'QUERIED', '', 'manager'))).toMatch(/at least 5/);
    expect((await w.service.reviewManualConfirmation('pay-9', 'OK', undefined, 'manager')).reviewedById).toBe('manager');
    expect(await code(w.service.reviewManualConfirmation('pay-9', 'OK', undefined, 'manager2'))).toBe('ALREADY_REVIEWED');
    expect([w.payment.status, w.tx.payment.updateMany.mock.calls.length]).toEqual(['COMPLETED', 0]);
  });
});

describe('wiring', () => {
  const meta = (m: string) => Reflect.getMetadata(PERMISSIONS_KEY, (PosController.prototype as any)[m]);
  it('reversal routes need payments:reverse; the review queue reports:view', () => {
    expect(meta('requestReversal')).toEqual(['payments:reverse']);
    expect(meta('approveReversal')).toEqual(['payments:reverse']);
    expect(meta('listManualConfirmations')).toEqual(['reports:view']);
    expect(meta('reviewManualConfirmation')).toEqual(['reports:view']);
  });
});
