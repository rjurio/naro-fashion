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
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      expect(call).toContain('tenantId');
    }
  });
});
