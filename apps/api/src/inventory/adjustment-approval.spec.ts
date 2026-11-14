import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { MANAGER_EXCLUDED } from '../roles/system-roles.seeder';
import { approvalRequired, directionOf } from './adjustment-policy';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

// Round 25F E: independent approval for write-offs and stock decreases.
describe('policy: which stock changes need a second person', () => {
  const none = { maxUnits: null, maxPct: null };
  it('increases never need approval; decreases always do while the owner has set no threshold', () => {
    expect(approvalRequired({ type: 'RESTOCK', quantity: 50, stockBefore: 1 }, none).required).toBe(false);
    expect(approvalRequired({ type: 'ADJUSTMENT', direction: 'INCREASE', quantity: 50, stockBefore: 1 }, none).required).toBe(false);
    expect(approvalRequired({ type: 'DAMAGE', quantity: 1, stockBefore: 10 }, none)).toEqual({ required: true, reason: 'NO_THRESHOLD_SET' });
    expect(approvalRequired({ type: 'ADJUSTMENT', direction: 'DECREASE', quantity: 1, stockBefore: 10 }, none).required).toBe(true);
  });
  it('with thresholds, a decrease is one-step only within EVERY threshold that is set', () => {
    expect(approvalRequired({ type: 'DAMAGE', quantity: 2, stockBefore: 10 }, { maxUnits: 2, maxPct: null }).required).toBe(false);
    expect(approvalRequired({ type: 'DAMAGE', quantity: 3, stockBefore: 10 }, { maxUnits: 2, maxPct: null }).reason).toBe('OVER_UNIT_THRESHOLD');
    expect(approvalRequired({ type: 'DAMAGE', quantity: 1, stockBefore: 10 }, { maxUnits: null, maxPct: 10 }).required).toBe(false);
    expect(approvalRequired({ type: 'DAMAGE', quantity: 2, stockBefore: 10 }, { maxUnits: null, maxPct: 10 }).reason).toBe('OVER_PERCENT_THRESHOLD');
    expect(approvalRequired({ type: 'DAMAGE', quantity: 1, stockBefore: 10 }, { maxUnits: 5, maxPct: 5 }).reason).toBe('OVER_PERCENT_THRESHOLD');
  });
  it('direction: DAMAGE is always a decrease, RESTOCK always an increase', () => {
    expect([directionOf('DAMAGE'), directionOf('RESTOCK', 'DECREASE'), directionOf('ADJUSTMENT'), directionOf('ADJUSTMENT', 'DECREASE')]).toEqual(['DECREASE', 'INCREASE', 'INCREASE', 'DECREASE']);
  });
});

function world(opts: { stock?: number; thresholds?: Record<string, string> } = {}) {
  const state = { stock: opts.stock ?? 10, requests: [] as any[], txns: [] as any[] };
  const audit = { log: jest.fn(async () => undefined) };
  let lock: Promise<unknown> = Promise.resolve();
  const tx: any = {
    productVariant: {
      findFirst: jest.fn(async () => ({ stock: state.stock })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (typeof where.stock === 'number' && where.stock !== state.stock) return { count: 0 };
        if (where.stock?.gte !== undefined && state.stock < where.stock.gte) return { count: 0 };
        state.stock = typeof data.stock === 'number' ? data.stock : state.stock + data.stock.increment;
        return { count: 1 };
      }),
    },
    product: { updateMany: jest.fn(async () => ({ count: 1 })) },
    inventoryTransaction: { create: jest.fn(async ({ data }: any) => { const r = { id: `t${state.txns.length + 1}`, ...data }; state.txns.push(r); return r; }) },
  };
  const prisma: any = {
    product: { findFirst: jest.fn(async () => ({ id: 'p1', availabilityMode: 'PURCHASE_ONLY', purchasePrice: 0 })) },
    productVariant: { findFirst: jest.fn(async () => ({ id: 'v1', productId: 'p1', stock: state.stock })), findMany: jest.fn(async () => [{ id: 'v1' }]) },
    siteSetting: { findMany: jest.fn(async () => Object.entries(opts.thresholds ?? {}).map(([key, value]) => ({ key, value }))) },
    inventoryAdjustmentRequest: {
      create: jest.fn(async ({ data }: any) => { const r = { id: `q${state.requests.length + 1}`, status: 'REQUESTED', transactionId: null, ...data }; state.requests.push(r); return r; }),
      findFirst: jest.fn(async ({ where }: any) => state.requests.find((r) => r.id === where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = state.requests.find((x) => x.id === where.id);
        if (!r || (where.status && r.status !== where.status) || (where.transactionId === null && r.transactionId)) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    // Emulates the database: transactions on the same row run one after the
    // other (row locks), and a failure inside the callback rolls back.
    $transaction: jest.fn((cb: any) => {
      const run = async () => {
        const snap = JSON.stringify({ stock: state.stock, requests: state.requests, txns: state.txns });
        try { return await cb(tx); } catch (e) {
          const o = JSON.parse(snap);
          state.stock = o.stock;
          state.requests.splice(0, state.requests.length, ...o.requests);
          state.txns.splice(0, state.txns.length, ...o.txns);
          throw e;
        }
      };
      const p = lock.then(run, run);
      lock = p.catch(() => undefined);
      return p;
    }),
  };
  // The approval's claim + ledger link run on the transaction client.
  tx.inventoryAdjustmentRequest = prisma.inventoryAdjustmentRequest;
  return { state, audit, svc: new InventoryService(prisma, { requireId: 't1' } as any, audit as any) };
}

describe('InventoryService: requests, approvals, stale stock', () => {
  it('a write-off with no threshold set becomes a REQUEST: nothing written, audited with the stock before / after', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'cashier');
    expect(r.status).toBe('PENDING_APPROVAL');
    expect([w.state.stock, w.state.txns.length]).toEqual([10, 0]);
    expect(w.audit.log).toHaveBeenCalledWith('INVENTORY_ADJUSTMENT_REQUESTED', 'Inventory', 'p1', expect.objectContaining({ stockBefore: 10, stockAfterIfApproved: 8 }));
  });
  it('a decrease within the owner threshold is one step (CAS, ledger row with before / after)', async () => {
    const w = world({ thresholds: { inventory_decrease_auto_max_units: '2' } });
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'ADJUSTMENT', direction: 'DECREASE', quantity: 1, note: 'recount found one fewer' } as any, 'cashier');
    expect([r.quantityBefore, r.quantityAfter, w.state.stock]).toEqual([10, 9, 9]);
  });
  it('decreases need a reason; increases are unchanged', async () => {
    const w = world();
    await expect(w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 1 } as any, 'cashier')).rejects.toMatchObject({ response: { code: 'DECREASE_REASON_REQUIRED' } });
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 3 } as any, 'cashier');
    expect(w.state.stock).toBe(13);
    expect(r.quantityChange).toBe(3);
  });
  it('the requester cannot approve their own request (403 SELF_APPROVAL, audited) — SUPER_ADMIN included: there is no role check', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'boss');
    await expect(w.svc.approveRequest(r.request.id, {}, 'boss')).rejects.toMatchObject({ response: { code: 'SELF_APPROVAL' } });
    expect(w.state.stock).toBe(10);
  });
  it('another approver applies it once; a second approval is refused (409 NOT_PENDING)', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'cashier');
    const done: any = await w.svc.approveRequest(r.request.id, { note: 'seen it' }, 'manager');
    expect([w.state.stock, done.status, w.state.txns.length, w.state.txns[0].reference, w.state.txns[0].performedBy]).toEqual([8, 'APPLIED', 1, `ADJ-REQ:${r.request.id}`, 'cashier']);
    await expect(w.svc.approveRequest(r.request.id, {}, 'manager2')).rejects.toMatchObject({ response: { code: 'NOT_PENDING' } });
    expect(w.state.stock).toBe(8);
  });
  it('stock changed since the request → 409 STOCK_CHANGED, request STALE, nothing written', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'cashier');
    w.state.stock = 9; // a sale happened meanwhile
    await expect(w.svc.approveRequest(r.request.id, {}, 'manager')).rejects.toMatchObject({ response: { code: 'STOCK_CHANGED' } });
    expect([w.state.stock, w.state.requests[0].status, w.state.txns.length]).toEqual([9, 'STALE', 0]);
  });
  it('two approvals at once → exactly one applies the change (one ledger row)', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'cashier');
    const out = await Promise.all(['m1', 'm2'].map((a) => w.svc.approveRequest(r.request.id, {}, a).then(() => 'OK', (e: any) => e.getResponse().code)));
    expect(out.sort()).toEqual(['NOT_PENDING', 'OK']);
    expect([w.state.stock, w.state.txns.length]).toEqual([8, 1]);
  });
  it('a failure after the claim rolls the claim back: the request is never APPLIED without its stock change', async () => {
    const w = world();
    const r: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 2, note: 'torn hem, not repairable' } as any, 'cashier');
    (w.svc as any).prisma.$transaction.mockImplementationOnce(async () => { throw new Error('db connection lost'); });
    await expect(w.svc.approveRequest(r.request.id, {}, 'manager')).rejects.toThrow('db connection lost');
    expect([w.state.stock, w.state.requests[0].status, w.state.txns.length]).toEqual([10, 'REQUESTED', 0]);
  });
  it('withdraw (requester only) and reject (someone else) close the request', async () => {
    const w = world();
    const a: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 1, note: 'stain on the train' } as any, 'cashier');
    await expect(w.svc.withdrawRequest(a.request.id, 'manager')).rejects.toMatchObject({ response: { code: 'NOT_REQUESTER' } });
    expect((await w.svc.withdrawRequest(a.request.id, 'cashier')).status).toBe('WITHDRAWN');
    const b: any = await w.svc.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 1, note: 'stain on the train' } as any, 'cashier');
    await expect(w.svc.rejectRequest(b.request.id, {}, 'cashier')).rejects.toMatchObject({ response: { code: 'SELF_DECISION' } });
    expect((await w.svc.rejectRequest(b.request.id, { note: 'cleanable' }, 'manager')).status).toBe('REJECTED');
    expect(w.state.stock).toBe(10);
  });
});

describe('wiring', () => {
  const meta = (m: string) => Reflect.getMetadata(PERMISSIONS_KEY, (InventoryController.prototype as any)[m]);
  it('approve / reject need inventory:approve; thresholds are an owner setting (settings:manage)', () => {
    expect(meta('approveRequest')).toEqual(['inventory:approve']);
    expect(meta('rejectRequest')).toEqual(['inventory:approve']);
    expect(meta('withdrawRequest')).toEqual(['inventory:manage']);
    expect(meta('setThresholds')).toEqual(['settings:manage']);
  });
  it('inventory:approve is never given to MANAGER automatically', () => {
    expect(MANAGER_EXCLUDED).toContain('inventory:approve');
  });
  it('the migration makes "a different person" a database rule too', () => {
    const m = readFileSync(join(__dirname, '../../../../packages/database/prisma/migrations/20261118120000_inventory_payment_approvals/migration.sql'), 'utf8');
    expect(m).toMatch(/InventoryAdjustmentRequest_independent_decider/);
    expect(m).toMatch(/PaymentReversalRequest_independent_decider/);
    expect(m).toMatch(/ManualPaymentReview_independent_reviewer/);
  });
});
