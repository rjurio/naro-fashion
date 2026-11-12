import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ProductsService, STOCK_EDIT_NOT_ALLOWED } from './products.service';

/**
 * Defect (found 2026-11-12): saving the admin product form re-sent every
 * variant's stock and the API wrote it back as an absolute value, without an
 * InventoryTransaction and without a concurrency check. A price edit made
 * while a sale happened therefore silently "restored" the sold unit.
 *
 * Fix: the product form never changes an existing variant's stock; any
 * differing stock value is refused (409) before anything is written; stock
 * moves only through sales / refunds / rentals / POS and Inventory → adjust.
 */

function world(initial: Array<{ id: string; stock: number; sku?: string }>) {
  const variants = new Map(initial.map((v) => [v.id, { productId: 'p1', tenantId: 't1', sku: v.sku ?? `sku-${v.id}`, name: v.id, price: 100, isActive: true, ...v }]));
  const product: any = { id: 'p1', slug: 'bouquet', tenantId: 't1', deletedAt: null, basePrice: 500, updatedAt: new Date('2026-11-12T08:00:00Z') };
  const ledger: any[] = [];
  const writes: string[] = [];
  /** Hook to simulate a concurrent sale committing in the middle of the save. */
  let midSave: (() => void) | null = null;
  const prisma: any = {
    product: {
      findFirst: jest.fn(async () => ({ ...product })),
      update: jest.fn(async ({ data }: any) => { writes.push('product.update'); Object.assign(product, data); return { ...product }; }),
      updateMany: jest.fn(async ({ data }: any) => { writes.push('product.updateMany'); Object.assign(product, data); return { count: 1 }; }),
    },
    category: { findFirst: jest.fn(async () => ({ id: 'c1' })) },
    sizeGuide: { findFirst: jest.fn(async () => ({ id: 'sg1' })) },
    productVariant: {
      findMany: jest.fn(async () => {
        const rows = [...variants.values()].map((v) => ({ id: v.id, sku: v.sku, stock: v.stock }));
        if (midSave) { const f = midSave; midSave = null; f(); }
        return rows;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        writes.push(`variant.update:${where.id}`);
        const v = variants.get(where.id)!;
        Object.assign(v, data);
        return { ...v };
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `new-${variants.size + 1}`;
        writes.push(`variant.create:${id}`);
        variants.set(id, { ...data, id });
        return { id, ...data };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        for (const id of where.id.in) { writes.push(`variant.disable:${id}`); Object.assign(variants.get(id)!, data); }
        return { count: where.id.in.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        for (const id of where.id.in) { writes.push(`variant.delete:${id}`); variants.delete(id); }
        return { count: where.id.in.length };
      }),
    },
    productImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    orderItem: { findMany: jest.fn(async () => []) },
    rentalOrder: { findMany: jest.fn(async () => []) },
    cartItem: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    inventoryTransaction: { create: jest.fn(async ({ data }: any) => { ledger.push(data); return data; }) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => {
    // all-or-nothing: snapshot and restore on error, like a real transaction
    const snapV = new Map([...variants].map(([k, v]) => [k, { ...v }]));
    const snapP = { ...product };
    const snapL = ledger.length;
    try {
      return await fn(prisma);
    } catch (e) {
      variants.clear();
      for (const [k, v] of snapV) variants.set(k, v);
      Object.assign(product, snapP);
      ledger.length = snapL;
      throw e;
    }
  });
  /** A sale elsewhere (POS / checkout): atomic decrement, like the real code. */
  const sell = (id: string, qty = 1) => { variants.get(id)!.stock -= qty; };
  const service = new ProductsService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
  return { service, prisma, variants, product, ledger, writes, sell, setMidSave: (f: () => void) => { midSave = f; } };
}

const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };

describe('product form never overwrites stock (API-level guard)', () => {
  it('a price-only edit (new form: no stock sent) changes the price and leaves stock untouched', async () => {
    const w = world([{ id: 'v1', stock: 11 }]);
    await w.service.update('p1', { price: 85000, variants: [{ id: 'v1', name: 'Standard', price: 85000 }] } as any, 'owner');
    expect(w.variants.get('v1')!.price).toBe(85000);
    expect(w.variants.get('v1')!.stock).toBe(11);
    expect(w.prisma.productVariant.update.mock.calls[0][0].data).not.toHaveProperty('stock');
    expect(w.ledger).toHaveLength(0);
  });

  it('an old form re-sending the SAME stock is accepted, but stock is still not written', async () => {
    const w = world([{ id: 'v1', stock: 11 }]);
    await w.service.update('p1', { variants: [{ id: 'v1', name: 'Standard', price: 500, stock: 11 }] } as any);
    expect(w.prisma.productVariant.update.mock.calls[0][0].data).not.toHaveProperty('stock');
    expect(w.variants.get('v1')!.stock).toBe(11);
  });

  it('a deliberate stock edit through the product form is refused with 409, and NOTHING is written', async () => {
    const w = world([{ id: 'v1', stock: 11 }]);
    const e = await err(w.service.update('p1', { price: 85000, variants: [{ id: 'v1', name: 'Standard', price: 85000, stock: 1 }] } as any));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ code: STOCK_EDIT_NOT_ALLOWED, variants: [{ variantId: 'v1', submitted: 1, current: 11 }] });
    expect(w.variants.get('v1')!.stock).toBe(11);
    expect(w.product.basePrice).toBe(500); // the price change in the same request is rolled back too
    expect(w.writes.filter((x) => x.startsWith('variant.'))).toEqual([]);
  });

  it('STALE FORM: page opened at stock 11, a sale happens, then the old form saves 11 → refused; the sale is kept', async () => {
    const w = world([{ id: 'v1', stock: 11 }]);
    const loaded = w.variants.get('v1')!.stock; // what the form showed
    w.sell('v1'); // POS sale commits: 10
    const e = await err(w.service.update('p1', { variants: [{ id: 'v1', name: 'Standard', price: 500, stock: loaded }] } as any));
    expect(e?.getResponse?.()).toMatchObject({ code: STOCK_EDIT_NOT_ALLOWED, variants: [{ submitted: 11, current: 10 }] });
    expect(w.variants.get('v1')!.stock).toBe(10);
  });

  it('CONCURRENT: a sale committing during the save is never undone (stock is not part of the write)', async () => {
    const w = world([{ id: 'v1', stock: 11 }]);
    w.setMidSave(() => w.sell('v1')); // sale lands after the save read the variants
    await w.service.update('p1', { price: 600, variants: [{ id: 'v1', name: 'Standard', price: 600 }] } as any);
    expect(w.variants.get('v1')!.stock).toBe(10);
    expect(w.variants.get('v1')!.price).toBe(600);
  });

  it('multi-variant: one bad stock value refuses the whole save; listed per variant', async () => {
    const w = world([{ id: 'v1', stock: 3 }, { id: 'v2', stock: 5 }]);
    const e = await err(w.service.update('p1', { variants: [
      { id: 'v1', name: 'S', price: 100, stock: 3 },
      { id: 'v2', name: 'M', price: 100, stock: 9 },
    ] } as any));
    expect(e?.getResponse?.().variants).toEqual([{ variantId: 'v2', submitted: 9, current: 5 }]);
    expect(w.writes).toEqual([]);
  });

  it('a NEW variant may start with opening stock, recorded as an ADJUSTMENT (never RESTOCK) with the performer', async () => {
    const w = world([{ id: 'v1', stock: 2 }]);
    await w.service.update('p1', { variants: [
      { id: 'v1', name: 'S', price: 100 },
      { name: 'XL', price: 150, stock: 3 },
    ] } as any, 'owner-id');
    const created = [...w.variants.values()].find((v) => v.name === 'XL')!;
    expect(created.stock).toBe(3);
    expect(w.ledger).toEqual([expect.objectContaining({
      type: 'ADJUSTMENT', quantityBefore: 0, quantityChange: 3, quantityAfter: 3,
      variantId: created.id, performedBy: 'owner-id', reference: 'product-form:new-variant', tenantId: 't1',
    })]);
  });

  it('a new variant without stock (or with junk / negative stock) starts at 0 and writes no ledger row', async () => {
    const w = world([]);
    await w.service.update('p1', { variants: [{ name: 'A', price: 1 }, { name: 'B', price: 1, stock: -4 }, { name: 'C', price: 1, stock: 'x' }] } as any);
    expect([...w.variants.values()].map((v) => v.stock)).toEqual([0, 0, 0]);
    expect(w.ledger).toHaveLength(0);
  });

  it('removing a variant that still holds stock disables it instead of deleting it (stock record kept)', async () => {
    const w = world([{ id: 'keep', stock: 1 }, { id: 'withStock', stock: 4 }, { id: 'empty', stock: 0 }]);
    await w.service.update('p1', { variants: [{ id: 'keep', name: 'S', price: 1 }] } as any);
    expect(w.writes).toContain('variant.disable:withStock');
    expect(w.writes).toContain('variant.delete:empty');
    expect(w.variants.get('withStock')).toMatchObject({ stock: 4, isActive: false });
  });

  it('the authorised path is unchanged: Inventory → adjust still writes stock atomically with a ledger row', () => {
    const inv = readFileSync(join(__dirname, '..', 'inventory', 'inventory.service.ts'), 'utf8');
    expect(inv).toMatch(/stock: \{ increment: quantityChange \}/);
    expect(inv).toMatch(/inventoryTransaction\.create/);
  });
});

describe('admin product form (source check)', () => {
  const form = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'components', 'products', 'ProductForm.tsx'), 'utf8');

  it('existing variants are submitted WITHOUT stock; only new variants carry opening stock', () => {
    expect(form).toMatch(/\.map\(\(\{ id, isActive, stock, \.\.\.rest \}\) =>\s*id \? \{ id, \.\.\.rest, \.\.\.\(isActive !== undefined \? \{ isActive \} : \{\}\) \} : \{ \.\.\.rest, stock \}/);
    // the existing-variant object must not mention stock at all
    const existingBranch = form.match(/id \? (\{ id, [^}]*\}[^:]*):/)?.[1] ?? '';
    expect(existingBranch).not.toMatch(/stock/);
    expect(form).toMatch(/: \{ \.\.\.rest, stock \}/);
  });

  it('existing variants show stock read-only with a link to Inventory', () => {
    expect(form).toMatch(/data-testid="variant-stock-readonly"/);
    expect(form).toMatch(/href="\/dashboard\/inventory"/);
  });
});
