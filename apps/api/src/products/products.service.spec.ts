import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * ProductsService unit tests — focused on the 2026-05-10 hotfix that
 * pushes `isActive: true` and `deletedAt: null` into the WHERE clause
 * of the public `findBySlug` method.
 *
 * The two methods under test:
 *   - `findBySlug(slug)` — wired to the @Public() route. MUST exclude
 *     inactive (draft) and soft-deleted products.
 *   - `findById(id)`    — wired to the admin-only route. MUST continue
 *     to return drafts so admins (and the AI agent's get_product tool)
 *     can edit/inspect them.
 *
 * All tests run against a mocked Prisma client — no DB, no Nest boot.
 */

describe('ProductsService — public vs admin product lookup', () => {
  let prismaMock: any;
  let tenantContextMock: any;
  let auditServiceMock: any;
  let service: ProductsService;

  const TENANT = 'tenant_t1';
  const OTHER_TENANT = 'tenant_t2';

  function activeProduct(overrides: any = {}) {
    return {
      id: 'p_active',
      tenantId: TENANT,
      slug: 'active-gown',
      name: 'Live Wedding Gown',
      isActive: true,
      deletedAt: null,
      basePrice: '850000',
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaMock = {
      product: { findFirst: jest.fn() },
    };
    tenantContextMock = { requireId: TENANT };
    auditServiceMock = { log: jest.fn() };
    service = new ProductsService(
      prismaMock,
      tenantContextMock,
      auditServiceMock,
    );
  });

  describe('findBySlug — PUBLIC route, drafts MUST NOT leak', () => {
    it('returns the product when active + not deleted', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
      const result = await service.findBySlug('active-gown');
      expect(result.id).toBe('p_active');
      expect(result.isActive).toBe(true);
    });

    it('throws 404 for an inactive product (DRAFT — was the bug)', async () => {
      // Filter excludes drafts → findFirst returns null
      prismaMock.product.findFirst.mockResolvedValueOnce(null);
      await expect(service.findBySlug('draft-gown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 for a soft-deleted product', async () => {
      // Filter excludes deletedAt != null → findFirst returns null
      prismaMock.product.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.findBySlug('deleted-gown'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when slug does not exist at all', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(null);
      await expect(service.findBySlug('does-not-exist')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    /**
     * REGRESSION GUARD — the whole point of the hotfix. If a future PR
     * accidentally drops `isActive: true` or `deletedAt: null` from the
     * where clause, this assertion fails and the build breaks before
     * drafts can leak again.
     */
    it('queries with isActive:true AND deletedAt:null in the where clause', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
      await service.findBySlug('any-slug');

      expect(prismaMock.product.findFirst).toHaveBeenCalledTimes(1);
      const args = prismaMock.product.findFirst.mock.calls[0][0];
      expect(args.where.slug).toBe('any-slug');
      expect(args.where.isActive).toBe(true);
      expect(args.where.deletedAt).toBeNull();
    });

    it('respects tenant scoping — uses tenantContext.requireId in the where clause', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
      await service.findBySlug('any-slug');
      const args = prismaMock.product.findFirst.mock.calls[0][0];
      expect(args.where.tenantId).toBe(TENANT);
    });

    it('cross-tenant: tenant A cannot fetch tenant B\'s active product by slug', async () => {
      // Simulate Prisma's actual behaviour — the where clause is composed
      // with tenantId, so a row owned by OTHER_TENANT never matches.
      prismaMock.product.findFirst.mockImplementationOnce((args: any) => {
        const fakeRow = activeProduct({ tenantId: OTHER_TENANT });
        if (args.where.tenantId !== fakeRow.tenantId) return null;
        return fakeRow;
      });
      await expect(
        service.findBySlug('cross-tenant-slug'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findById — ADMIN route, drafts MUST remain visible', () => {
    it('returns inactive (draft) product for admins', async () => {
      const draft = activeProduct({ id: 'p_draft', isActive: false });
      prismaMock.product.findFirst.mockResolvedValueOnce(draft);
      const result = await service.findById('p_draft');
      expect(result.id).toBe('p_draft');
      expect(result.isActive).toBe(false);
    });

    it('still throws 404 for a soft-deleted product', async () => {
      // Admin route's existing post-fetch deletedAt check still applies.
      const deleted = activeProduct({ deletedAt: new Date() });
      prismaMock.product.findFirst.mockResolvedValueOnce(deleted);
      await expect(service.findById('p_active')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does NOT add isActive to the admin where clause (drafts deliberately visible)', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
      await service.findById('p_active');
      const args = prismaMock.product.findFirst.mock.calls[0][0];
      // The fix targets findBySlug ONLY. findById must keep its existing
      // shape so admins (and the AI agent's get_product tool) keep seeing
      // drafts.
      expect(args.where.isActive).toBeUndefined();
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.where.id).toBe('p_active');
    });
  });

  describe('public vs admin contract — explicit summary', () => {
    it('findBySlug WHERE clause is stricter than findById WHERE clause', async () => {
      prismaMock.product.findFirst.mockResolvedValue(activeProduct());

      await service.findBySlug('s');
      const slugWhere = prismaMock.product.findFirst.mock.calls[0][0].where;

      await service.findById('id1');
      const idWhere = prismaMock.product.findFirst.mock.calls[1][0].where;

      // The public path adds isActive + deletedAt; the admin path adds
      // neither. Asserting the diff explicitly so a future "tidy-up" PR
      // can't accidentally collapse the two methods into one.
      expect(slugWhere.isActive).toBe(true);
      expect(slugWhere.deletedAt).toBeNull();
      expect(idWhere.isActive).toBeUndefined();
      expect(idWhere.deletedAt).toBeUndefined();
    });
  });
});
