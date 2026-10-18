import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PosService, POS_CATALOG_MAX_PRODUCTS } from './pos.service';

/**
 * GET /pos/catalog — the compact product snapshot the admin keeps on the
 * device for offline POS search / barcode lookup (admin offline mode,
 * Phase 3). Must be tenant-scoped and sit behind the same guards as the
 * existing POS product search.
 */

function makeService(rows: any[], tenant: any = { requireId: 't1' }) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma: any = { product: { findMany } };
  return { service: new PosService(prisma, tenant), findMany };
}

const product = (over: any = {}) => ({
  id: 'p1',
  name: 'Ball Gown',
  sku: 'GOW-1',
  category: { id: 'c1', name: 'Gowns' },
  images: [{ url: '/uploads/products/p1.jpg' }],
  variants: [
    { id: 'v1', name: 'M', sku: 'GOW-1-M', barcode: '12345', size: 'M', color: null, colorHex: null, price: '45000.00', stock: 3 },
  ],
  ...over,
});

describe('PosService.getCatalog', () => {
  it('queries only THIS tenant’s active, non-deleted products', async () => {
    const { service, findMany } = makeService([product()]);
    await service.getCatalog();
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 't1', isActive: true, deletedAt: null });
    expect(args.select.variants.where).toEqual({ isActive: true });
    expect(args.take).toBe(POS_CATALOG_MAX_PRODUCTS + 1);
  });

  it('never queries without a tenant (requireId throws first)', async () => {
    const tenant = {
      get requireId(): string {
        throw new BadRequestException('Tenant context is required');
      },
    };
    const { service, findMany } = makeService([product()], tenant);
    await expect(service.getCatalog()).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns a compact shape with numeric prices, image + category name', async () => {
    const { service } = makeService([product()]);
    const res = await service.getCatalog();
    expect(res.truncated).toBe(false);
    expect(typeof res.generatedAt).toBe('string');
    expect(res.products).toEqual([
      {
        id: 'p1',
        name: 'Ball Gown',
        sku: 'GOW-1',
        categoryId: 'c1',
        categoryName: 'Gowns',
        imageUrl: '/uploads/products/p1.jpg',
        variants: [
          { id: 'v1', name: 'M', sku: 'GOW-1-M', barcode: '12345', size: 'M', color: null, colorHex: null, price: 45000, stock: 3 },
        ],
      },
    ]);
  });

  it('omits products with no active variant and tolerates missing image/category', async () => {
    const { service } = makeService([
      product({ id: 'p-empty', variants: [] }),
      product({ id: 'p2', images: [], category: null }),
    ]);
    const res = await service.getCatalog();
    expect(res.products.map((p) => p.id)).toEqual(['p2']);
    expect(res.products[0].imageUrl).toBeNull();
    expect(res.products[0].categoryName).toBeNull();
  });

  it('flags truncation above the product cap', async () => {
    const rows = Array.from({ length: POS_CATALOG_MAX_PRODUCTS + 1 }, (_, i) => product({ id: `p${i}` }));
    const { service } = makeService(rows);
    const res = await service.getCatalog();
    expect(res.truncated).toBe(true);
    expect(res.products).toHaveLength(POS_CATALOG_MAX_PRODUCTS);
  });
});

describe('pos.controller GET catalog guard shape', () => {
  const ctrl = readFileSync(join(__dirname, 'pos.controller.ts'), 'utf8');

  it('exists, and the POS controller is class-guarded (JWT + Admin + Module + Permission) for module pos', () => {
    expect(ctrl).toMatch(/@Get\('catalog'\)\s*getCatalog\(\)/);
    expect(ctrl).toMatch(/@UseGuards\(JwtAuthGuard,\s*AdminGuard,\s*ModuleGuard,\s*PermissionGuard\)\s*@RequiresModule\('pos'\)\s*export class PosController/);
  });

  it('is not public', () => {
    expect(ctrl).not.toMatch(/@Public\(\)/);
  });
});
