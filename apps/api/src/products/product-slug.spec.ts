import { BadRequestException, ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INVALID_SLUG, ProductsService, SLUG_TAKEN, isValidSlug, slugify } from './products.service';

/**
 * Defect (found 2026-11-12): every admin product save regenerated the slug
 * from the name plus a new timestamp, so the public URL (/products/<slug>,
 * /rentals/<slug>) changed on every edit and old links broke. Fix: renaming
 * never changes the slug; an explicit change must be valid and unused; new
 * products still get valid, unique slugs.
 */
const BOUQUET_SLUG = 'orange-rose-white-hydrangea-bridal-bouquet-mo8c6y6j';

function world() {
  const products: any[] = [
    { id: 'p1', tenantId: 't1', slug: BOUQUET_SLUG, name: 'Orange Rose & White Hydrangea Bridal Bouquet', deletedAt: null, basePrice: 500 },
    { id: 'p2', tenantId: 't1', slug: 'red-sequin-off-shoulder-sendoff-gown', name: 'Red Sequin', deletedAt: null, basePrice: 1000 },
    { id: 'p3', tenantId: 't1', slug: 'old-deleted-gown', name: 'Old', deletedAt: new Date(), basePrice: 1 },
    { id: 'px', tenantId: 't2', slug: 'elegant-evening-gown', name: 'Other shop', deletedAt: null, basePrice: 1 },
  ];
  const variants = [{ id: 'v1', productId: 'p1', tenantId: 't1', stock: 11, price: 500, sku: 'sku-1' }];
  const matches = (p: any, w: any) =>
    Object.entries(w).every(([k, v]: any) => (v && typeof v === 'object' && 'not' in v ? p[k] !== v.not : p[k] === v));
  const prisma: any = {
    product: {
      findFirst: jest.fn(async ({ where }: any) => products.find((p) => matches(p, where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const p = products.find((x) => x.id === where.id); Object.assign(p, data); return { ...p }; }),
      create: jest.fn(async ({ data }: any) => { const p = { id: `new${products.length}`, deletedAt: null, ...data }; products.push(p); return p; }),
    },
    category: { findFirst: jest.fn(async () => ({ id: 'c1' })) },
    sizeGuide: { findFirst: jest.fn(async () => ({ id: 'sg1' })) },
    productVariant: {
      findMany: jest.fn(async () => variants.map((v) => ({ id: v.id, sku: v.sku, stock: v.stock }))),
      update: jest.fn(async () => ({})), create: jest.fn(async () => ({})), updateMany: jest.fn(), deleteMany: jest.fn(),
    },
    productImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    orderItem: { findMany: jest.fn(async () => []) },
    rentalOrder: { findMany: jest.fn(async () => []) },
    cartItem: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    inventoryTransaction: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  const service = new ProductsService(prisma, { requireId: 't1' } as any, { log: jest.fn() } as any);
  const p1 = () => products.find((p) => p.id === 'p1');
  return { service, prisma, products, variants, p1 };
}
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return e; } };

describe('editing a product keeps its web address', () => {
  it('renaming never changes the slug', async () => {
    const w = world();
    await w.service.update('p1', { name: 'Bridal Bouquet - Orange & White' } as any);
    expect(w.p1().slug).toBe(BOUQUET_SLUG);
    expect(w.prisma.product.update.mock.calls[0][0].data).not.toHaveProperty('slug');
  });

  it('an OLD cached admin page that sends a name-derived slug (no confirmSlugChange) cannot change the URL', async () => {
    const w = world();
    // the old form re-derived the slug from the name on load and on every edit
    await w.service.update('p1', { name: 'Orange Rose & White Hydrangea Bridal Bouquet', slug: 'orange-rose-white-hydrangea-bridal-bouquet', price: 600 } as any);
    await w.service.update('p1', { name: 'Renamed Bouquet', slug: 'renamed-bouquet' } as any);
    expect(w.p1().slug).toBe(BOUQUET_SLUG);
    for (const c of w.prisma.product.update.mock.calls) expect(c[0].data).not.toHaveProperty('slug');
  });

  it('a slug sent without the flag is ignored even if invalid or taken (no error, no change)', async () => {
    const w = world();
    await w.service.update('p1', { slug: 'Not Valid', price: 7 } as any);
    await w.service.update('p1', { slug: 'red-sequin-off-shoulder-sendoff-gown', price: 8 } as any);
    expect(w.p1()).toMatchObject({ slug: BOUQUET_SLUG, basePrice: 8 });
  });

  it('a price-only save (the approved bouquet prices) keeps the slug, and stock is untouched', async () => {
    const w = world();
    await w.service.update('p1', { name: 'Orange Rose & White Hydrangea Bridal Bouquet', price: 1_200_000, slug: BOUQUET_SLUG,
      variants: [{ id: 'v1', name: 'Standard', price: 1_200_000 }] } as any);
    expect(w.p1()).toMatchObject({ slug: BOUQUET_SLUG, basePrice: 1_200_000 });
    expect(w.variants[0].stock).toBe(11);
  });

  it('an explicit, valid, unused new slug is applied (and only the slug changes)', async () => {
    const w = world();
    await w.service.update('p1', { slug: 'orange-rose-bridal-bouquet', confirmSlugChange: true } as any);
    expect(w.p1().slug).toBe('orange-rose-bridal-bouquet');
    expect(w.prisma.product.update.mock.calls[0][0].data).toEqual({ slug: 'orange-rose-bridal-bouquet' }); // the flag itself is not stored
  });

  it.each(['Orange Rose', 'orange_rose', 'orange--rose', '-orange', 'orange-', 'ab', 'a'.repeat(201), 'rosé'])(
    'an invalid slug %p is refused with 400 INVALID_SLUG and nothing is written', async (bad) => {
      const w = world();
      const e = await err(w.service.update('p1', { slug: bad, price: 9, confirmSlugChange: true } as any));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().code).toBe(INVALID_SLUG);
      expect(w.prisma.product.update).not.toHaveBeenCalled();
      expect(w.p1().slug).toBe(BOUQUET_SLUG);
    });

  it('a slug already used by another product (even a deleted one) is refused with 409 SLUG_TAKEN', async () => {
    for (const taken of ['red-sequin-off-shoulder-sendoff-gown', 'old-deleted-gown']) {
      const w = world();
      const e = await err(w.service.update('p1', { slug: taken, confirmSlugChange: true } as any));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(SLUG_TAKEN);
      expect(w.prisma.product.update).not.toHaveBeenCalled();
    }
  });

  it('another shop using the same slug does not block it (slugs are unique per shop)', async () => {
    const w = world();
    await w.service.update('p1', { slug: 'elegant-evening-gown', confirmSlugChange: true } as any);
    expect(w.p1().slug).toBe('elegant-evening-gown');
  });

  it('an empty or unchanged slug is a no-op', async () => {
    const w = world();
    await w.service.update('p1', { slug: '  ', confirmSlugChange: true } as any);
    await w.service.update('p1', { slug: BOUQUET_SLUG, confirmSlugChange: true } as any);
    expect(w.p1().slug).toBe(BOUQUET_SLUG);
    expect(w.prisma.product.findFirst.mock.calls.filter((c: any) => c[0].where.id?.not)).toHaveLength(0);
  });
});

describe('new products still get valid, unique slugs', () => {
  const create = (w: ReturnType<typeof world>, dto: any) =>
    w.service.create({ categoryId: 'c1', price: 100, availabilityMode: 'PURCHASE_ONLY', ...dto } as any);

  it('from the name when free; normalised and valid', async () => {
    const w = world();
    const r: any = await create(w, { name: 'Élégant Evening Gown!' });
    expect(r.slug).toBe('elegant-evening-gown');
    expect(isValidSlug(r.slug)).toBe(true);
  });

  it('a taken slug gets a unique suffix instead of failing (including deleted products)', async () => {
    for (const name of ['Red Sequin Off-Shoulder Sendoff Gown', 'Old Deleted Gown']) {
      const w = world();
      const r: any = await create(w, { name });
      expect(r.slug).toMatch(/^(red-sequin-off-shoulder-sendoff-gown|old-deleted-gown)-[a-z0-9]+$/);
      expect(isValidSlug(r.slug)).toBe(true);
    }
  });

  it('a supplied slug is normalised; very short or empty names still give a valid slug', async () => {
    const w = world();
    expect((await create(w, { name: 'X', slug: 'My Custom URL' }) as any).slug).toBe('my-custom-url');
    expect(isValidSlug((await create(w, { name: '!' }) as any).slug)).toBe(true);
    expect(isValidSlug((await create(w, { name: 'ab' }) as any).slug)).toBe(true);
  });

  it('slugify / isValidSlug basics', () => {
    expect(slugify('  Orange Rose & White  ')).toBe('orange-rose-white');
    expect(isValidSlug('orange-rose-white')).toBe(true);
    expect(isValidSlug('Orange')).toBe(false);
  });
});

describe('admin product form (source check)', () => {
  const form = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'components', 'products', 'ProductForm.tsx'), 'utf8');

  it('only derives the slug from the name when creating, never when editing', () => {
    expect(form).toMatch(/const isEdit = !!initialData;/);
    expect(form).toMatch(/if \(!isEdit && name\) \{\s*setSlug\(/);
  });

  it('does not send the slug when editing, and tells the admin the address stays the same', () => {
    expect(form).toMatch(/\.\.\.\(isEdit \? \{\} : \{ slug: slug\.trim\(\) \}\)/);
    expect(form).not.toMatch(/^\s*slug: slug\.trim\(\),\s*$/m);
    expect(form).toMatch(/The web address stays the same when you rename the product/);
  });
});
