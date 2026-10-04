import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ProductsService } from './products.service';

/**
 * Regression specs (Oct 2026 review):
 *  #1 ProductVariant rows must ALWAYS carry tenantId (nested create on
 *     product create — also the CSV bulk-import + AI create_product_draft
 *     paths, which call create()).
 *  #2 Product update must diff/upsert variants, never delete-all + recreate
 *     (OrderItem/RentalOrder Restrict FKs made editing a sold product throw;
 *     CartItem cascade silently emptied carts).
 *  #3 categoryId / sizeGuideId must belong to the caller's tenant.
 */
describe('ProductsService — variant tenancy + diff update', () => {
  const TENANT = 'tenant_a';
  let prisma: any;
  let service: ProductsService;

  beforeEach(() => {
    prisma = {
      product: {
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'p1', ...args.data })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      category: { findFirst: jest.fn().mockResolvedValue({ id: 'cat1' }), findMany: jest.fn() },
      sizeGuide: { findFirst: jest.fn().mockResolvedValue({ id: 'sg1' }) },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn(),
      },
      productImage: { deleteMany: jest.fn(), createMany: jest.fn() },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    service = new ProductsService(prisma, { requireId: TENANT } as any, { log: jest.fn() } as any);
  });

  describe('#1 create — every variant gets tenantId', () => {
    it('sets tenantId on each nested variant create', async () => {
      await service.create({
        name: 'Gown',
        description: 'd',
        price: 100,
        categoryId: 'cat1',
        variants: [
          { name: 'S', price: 100, stock: 1 },
          { name: 'M', price: 100, stock: 2 },
        ],
      } as any);
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data.tenantId).toBe(TENANT);
      expect(data.variants.create).toHaveLength(2);
      for (const v of data.variants.create) expect(v.tenantId).toBe(TENANT);
    });

    it('bulkImport routes through create() so CSV variants carry tenantId', async () => {
      prisma.category.findMany.mockResolvedValue([{ id: 'cat1', slug: 'gowns', name: 'Gowns' }]);
      prisma.product.findMany = jest.fn().mockResolvedValue([]);
      const csv = 'name,description,price,categorySlug,stock\nGown,Nice,5000,gowns,3\n';
      const res = await service.bulkImport(Buffer.from(csv));
      expect(res.created).toBe(1);
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data.variants.create[0].tenantId).toBe(TENANT);
    });

    it('source: no productVariant.createMany / nested create without tenantId', () => {
      const src = fs.readFileSync(path.join(__dirname, 'products.service.ts'), 'utf8');
      expect(src).not.toMatch(/productVariant\.createMany/);
      // The nested create block must contain tenantId.
      const nested = src.match(/variants = \{[\s\S]*?create: dto\.variants\.map\(\(v, i\) => \(\{([\s\S]*?)\}\)\)/);
      expect(nested).not.toBeNull();
      expect(nested![1]).toMatch(/\btenantId\b/);
    });
  });

  describe('#3 create/update — foreign ids must be same-tenant', () => {
    it('404s when categoryId belongs to another tenant', async () => {
      prisma.category.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.create({ name: 'X', description: 'd', price: 1, categoryId: 'foreign' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'foreign', tenantId: TENANT });
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('404s when sizeGuideId belongs to another tenant (update)', async () => {
      prisma.product.findFirst.mockResolvedValueOnce({ id: 'p1', slug: 'gown', deletedAt: null });
      prisma.sizeGuide.findFirst.mockResolvedValueOnce(null);
      await expect(service.update('p1', { sizeGuideId: 'foreign-sg' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sizeGuide.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'foreign-sg', tenantId: TENANT });
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('#2 update — variants diffed, never delete-all', () => {
    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', slug: 'gown', deletedAt: null });
      prisma.productVariant.findMany.mockResolvedValue([
        { id: 'v_keep', sku: 'gown-v1' },
        { id: 'v_sold', sku: 'gown-v2' },
        { id: 'v_unused', sku: 'gown-v3' },
      ]);
    });

    it('updates by id, creates new with tenantId, disables referenced, deletes unreferenced', async () => {
      prisma.orderItem.findMany.mockResolvedValue([{ variantId: 'v_sold' }]);
      await service.update('p1', {
        variants: [
          { id: 'v_keep', name: 'S (edited)', price: 120, stock: 4 },
          { name: 'XL', price: 150, stock: 1 },
        ],
      } as any);

      // kept variant updated in place — same id
      expect(prisma.productVariant.update).toHaveBeenCalledTimes(1);
      const upd = prisma.productVariant.update.mock.calls[0][0];
      expect(upd.where).toEqual({ id: 'v_keep' });
      expect(upd.data).toMatchObject({ tenantId: TENANT, name: 'S (edited)', price: 120, stock: 4, sku: 'gown-v1' });

      // new variant created with tenantId
      expect(prisma.productVariant.create).toHaveBeenCalledTimes(1);
      expect(prisma.productVariant.create.mock.calls[0][0].data).toMatchObject({ tenantId: TENANT, productId: 'p1', name: 'XL' });

      // sold variant soft-disabled, unused variant hard-deleted
      expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['v_sold'] }, productId: 'p1' },
        data: { isActive: false, tenantId: TENANT },
      });
      expect(prisma.productVariant.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['v_unused'] }, productId: 'p1' },
      });
      // never a blanket delete of every variant of the product
      for (const call of prisma.productVariant.deleteMany.mock.calls) {
        expect(call[0].where.id).toBeDefined();
      }
      // carts only lose lines for removed variants
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { variantId: { in: ['v_sold', 'v_unused'] } } });
    });

    it('rental references also block hard delete', async () => {
      prisma.rentalOrder.findMany.mockResolvedValue([{ variantId: 'v_unused' }]);
      await service.update('p1', {
        variants: [
          { id: 'v_keep', name: 'S', price: 1 },
          { id: 'v_sold', name: 'M', price: 1 },
        ],
      } as any);
      expect(prisma.productVariant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['v_unused'] }, productId: 'p1' } }),
      );
      expect(prisma.productVariant.deleteMany).not.toHaveBeenCalled();
    });

    it('an id that is not this product\'s variant is treated as new (no cross-product update)', async () => {
      await service.update('p1', {
        variants: [
          { id: 'v_keep', name: 'S', price: 1 },
          { id: 'v_sold', name: 'M', price: 1 },
          { id: 'v_unused', name: 'L', price: 1 },
          { id: 'someone_elses_variant', name: 'Injected', price: 1 },
        ],
      } as any);
      expect(prisma.productVariant.update.mock.calls.map((c: any) => c[0].where.id)).not.toContain('someone_elses_variant');
      expect(prisma.productVariant.create.mock.calls[0][0].data).toMatchObject({ productId: 'p1', tenantId: TENANT, name: 'Injected' });
    });

    it('omitting variants leaves them untouched', async () => {
      await service.update('p1', { name: 'Renamed' } as any);
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      expect(prisma.productVariant.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('#5 public product detail only includes approved reviews', () => {
    const src = fs.readFileSync(path.join(__dirname, 'products.service.ts'), 'utf8');
    const block = src.match(/const publicProductDetailSelect = \{[\s\S]*?reviews: \{([\s\S]*?)select:/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/where: \{ isApproved: true \}/);
  });
});
