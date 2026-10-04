import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * POS tenant-scoping + stock-safety invariants (2026-07-28 review).
 *
 * The POS module was the one place that never received the service-layer
 * tenant-scoping pass: variant lookups by id/barcode had no tenantId filter
 * (cross-tenant stock tampering) and stock was written as an absolute value
 * from a stale pre-transaction read (oversell race). These shape checks lock
 * the fixes so a future edit can't silently reintroduce either class.
 */
describe('pos.service tenant-scope + stock-safety invariants', () => {
  const src = readFileSync(join(__dirname, 'pos.service.ts'), 'utf8');

  // Strip comments so an explanatory comment mentioning findUnique can't trip
  // the substring checks below.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never looks up a ProductVariant by id/barcode without a tenant filter (no productVariant.findUnique)', () => {
    // ProductVariant.findUnique can only key on id/sku/barcode — none of which
    // is tenant-safe on its own. All POS variant reads must go through
    // findFirst({ where: { ..., tenantId } }) or updateMany with tenantId.
    expect(code).not.toContain('productVariant.findUnique');
  });

  it('never writes an absolute stock value from a stale read (no "stock: newStock")', () => {
    // Stock must change via atomic { increment } / { decrement } inside the
    // transaction, never `data: { stock: <precomputed> }`.
    expect(code).not.toMatch(/data:\s*\{\s*stock:\s*newStock/);
  });

  it('uses atomic guarded decrements for stock deduction (updateMany with stock gte guard)', () => {
    // Every sale/layaway/exchange deduction path uses the guarded pattern
    // `updateMany({ where: { id, tenantId, stock: { gte: qty } }, data: { stock: { decrement } } })`.
    const decrements = code.match(/stock:\s*\{\s*decrement:/g) ?? [];
    const gteGuards = code.match(/stock:\s*\{\s*gte:/g) ?? [];
    expect(decrements.length).toBeGreaterThanOrEqual(3); // createSale, completeLayaway, createExchange
    // Each decrement path is paired with a gte guard so stock can't go negative.
    expect(gteGuards.length).toBeGreaterThanOrEqual(decrements.length);
  });

  it('every productVariant.updateMany is tenant-scoped', () => {
    // Pull each updateMany(...) call and assert its where includes tenantId.
    const calls = code.match(/productVariant\.updateMany\(\{[\s\S]*?\}\)/g) ?? [];
    // 3 guarded decrements (sale, layaway, exchange) + the shared\n    // restockVariant() helper used by refunds and exchange returns.\n    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call).toContain('tenantId');
    }
  });

  it('refundedQuantity only changes via an atomic guarded increment (never an absolute stale write)', () => {
    // refundSale + createExchange claim units with
    // updateMany({ where: { refundedQuantity: { lte: quantity - n } }, data: { refundedQuantity: { increment: n } } }).
    expect(code).not.toMatch(/refundedQuantity:\s*orderItem\.refundedQuantity\s*\+/);
    expect(code).not.toMatch(/data:\s*\{\s*refundedQuantity:\s*item\.quantity/);
    const claims = code.match(/orderItem\.updateMany\(\{[\s\S]*?refundedQuantity:\s*\{\s*increment:/g) ?? [];
    expect(claims.length).toBeGreaterThanOrEqual(2); // refundSale, createExchange
    for (const c of claims) expect(c).toMatch(/refundedQuantity:\s*\{\s*lte:/);
  });

  it('refund/exchange value uses the net-price helper, not raw unitPrice × qty', () => {
    expect(code).not.toMatch(/refundAmount\s*\+=\s*Number\([a-zA-Z]+\.unitPrice\)/);
    expect(code).not.toMatch(/returnTotal\s*\+=\s*Number\(orderItem\.unitPrice\)/);
    expect((code.match(/refundValueForUnits\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('layaway state changes are conditional transitions (idempotent claims)', () => {
    expect(code).toMatch(/layaway\.updateMany\(\{\s*where:\s*\{\s*id,\s*tenantId,\s*status:\s*'ACTIVE',\s*balanceDue:\s*\{\s*gte:/);
    expect(code).toMatch(/layaway\.updateMany\(\{\s*where:\s*\{\s*id,\s*tenantId,\s*status:\s*'ACTIVE',\s*balanceDue:\s*\{\s*lte:\s*0/);
    // No absolute balance write from a stale read.
    expect(code).not.toMatch(/balanceDue:\s*newBalanceDue/);
  });

  it('every POS payment.create tags the drawer session for cash reconciliation', () => {
    const creates = code.match(/payment\.create\(\{[\s\S]*?\n\s{6,10}\}\);/g) ?? [];
    expect(creates.length).toBeGreaterThanOrEqual(6);
    for (const c of creates) expect(c).toMatch(/gatewayResponse:/);
    // Drawer math keys on the session tag, not order.posSessionId.
    expect(code).toMatch(/path:\s*\['posSessionId'\]/);
  });

  it('customerId is tenant-validated on sale, layaway and held sale', () => {
    expect((code.match(/assertCustomerInTenant\(dto\.customerId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('pos.controller refund permission', () => {
  const ctrl = readFileSync(join(__dirname, 'pos.controller.ts'), 'utf8');
  it("refund and exchange routes require 'pos:refund' via PermissionGuard", () => {
    expect(ctrl).toMatch(/PermissionGuard\)/);
    expect(ctrl).toMatch(/@Post\('sales\/:id\/refund'\)\s*@RequiresPermission\('pos:refund'\)/);
    expect(ctrl).toMatch(/@Post\('exchanges'\)\s*@RequiresPermission\('pos:refund'\)/);
  });
});