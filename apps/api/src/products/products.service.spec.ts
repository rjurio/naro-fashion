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
      product: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      category: { findFirst: jest.fn(), findMany: jest.fn() },
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
      // Note: the public select intentionally drops `isActive` from the
      // response. We assert against the WHERE clause separately below.
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

  /**
   * Response-shape whitelist tests — 2026-05-11.
   *
   * Public storefront endpoints (`findAll`, `findBySlug`) must NOT leak
   * admin-only columns: `tenantId`, `purchasePrice`, `minimumStock`,
   * `supplierName`, `supplierContact`, `lastRestockedAt`, `deletedAt`,
   * `updatedAt`. Variant `barcode` is also admin/POS-only.
   *
   * Admin endpoints (`findAllAdmin`, `findById`) keep full row access so
   * the inventory/cost-basis UI keeps working. We assert the diff at the
   * Prisma-call level — what was passed as `select` vs `include` — so a
   * future refactor that switches to `include` (or adds an admin field to
   * the public select) fails the build.
   */
  describe('Response whitelist — public must not leak admin/internal fields', () => {
    const ADMIN_ONLY_FIELDS = [
      'tenantId',
      'purchasePrice',
      'minimumStock',
      'supplierName',
      'supplierContact',
      'lastRestockedAt',
      'deletedAt',
      'updatedAt',
      // Phase 3.1B.α — archivedAt is admin lifecycle metadata. It MUST
      // never appear in a public response or the storefront could derive
      // "this product was archived" from a missing-but-visible row.
      // Public visibility is gated by isActive+deletedAt only.
      'archivedAt',
    ] as const;

    const STOREFRONT_REQUIRED_FIELDS = [
      'id',
      'slug',
      'name',
      'description',
      'categoryId',
      'availabilityMode',
      'basePrice',
      'compareAtPrice',
      'sku',
      'isFeatured',
      'sizeGuideId',
      'specifications',
      'rentalPricePerDay',
      'rentalDownPaymentPct',
      'minRentalDays',
      'maxRentalDays',
      'bufferDaysOverride',
      'avgRating',
      'reviewCount',
      'model3dUrl',
      'model3dPosterUrl',
      'category',
      'images',
      'variants',
    ] as const;

    describe('findAll (GET /products) — public list', () => {
      beforeEach(() => {
        prismaMock.product.findMany.mockResolvedValue([]);
        prismaMock.product.count.mockResolvedValue(0);
      });

      it.each(ADMIN_ONLY_FIELDS)(
        'does NOT include %s in the Prisma select',
        async (field) => {
          await service.findAll({} as any);
          const args = prismaMock.product.findMany.mock.calls[0][0];
          expect(args.select).toBeDefined();
          expect(args.include).toBeUndefined();
          expect(args.select[field]).toBeUndefined();
        },
      );

      it.each(STOREFRONT_REQUIRED_FIELDS)(
        'DOES include %s — storefront grid depends on it',
        async (field) => {
          await service.findAll({} as any);
          const args = prismaMock.product.findMany.mock.calls[0][0];
          expect(args.select[field]).toBeTruthy();
        },
      );

      it('isActive: true is still enforced in the where clause (draft-leak fix preserved)', async () => {
        await service.findAll({} as any);
        const args = prismaMock.product.findMany.mock.calls[0][0];
        expect(args.where.isActive).toBe(true);
        expect(args.where.deletedAt).toBeNull();
        expect(args.where.tenantId).toBe(TENANT);
      });

      it('returns only one image per card with a take:1 cap', async () => {
        await service.findAll({} as any);
        const args = prismaMock.product.findMany.mock.calls[0][0];
        expect(args.select.images.take).toBe(1);
      });
    });

    describe('findBySlug (GET /products/:slug) — public detail', () => {
      it.each(ADMIN_ONLY_FIELDS)(
        'does NOT include %s in the Prisma select',
        async (field) => {
          prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
          await service.findBySlug('slug');
          const args = prismaMock.product.findFirst.mock.calls[0][0];
          expect(args.select).toBeDefined();
          expect(args.include).toBeUndefined();
          expect(args.select[field]).toBeUndefined();
        },
      );

      it.each(STOREFRONT_REQUIRED_FIELDS)(
        'DOES include %s — storefront detail page depends on it',
        async (field) => {
          prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
          await service.findBySlug('slug');
          const args = prismaMock.product.findFirst.mock.calls[0][0];
          expect(args.select[field]).toBeTruthy();
        },
      );

      it('exposes the size guide and reviews block (storefront tabs)', async () => {
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        await service.findBySlug('slug');
        const args = prismaMock.product.findFirst.mock.calls[0][0];
        expect(args.select.sizeGuideRef).toBeTruthy();
        expect(args.select.reviews).toBeTruthy();
        expect(args.select.reviews.take).toBe(10);
        // Reviewer's name + avatar are fine; the review's `tenantId`,
        // `isApproved`, `updatedAt`, `userId`, and `productId` are NOT
        // useful to customers — so we select explicit review fields.
        expect(args.select.reviews.select.user).toBeTruthy();
        expect(args.select.reviews.include).toBeUndefined();
      });

      it('variants are filtered to isActive and do NOT expose barcode (POS-only)', async () => {
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        await service.findBySlug('slug');
        const args = prismaMock.product.findFirst.mock.calls[0][0];
        expect(args.select.variants.where.isActive).toBe(true);
        expect(args.select.variants.select.barcode).toBeUndefined();
        // Storefront-needed variant fields are present.
        expect(args.select.variants.select.id).toBe(true);
        expect(args.select.variants.select.price).toBe(true);
        expect(args.select.variants.select.stock).toBe(true);
        expect(args.select.variants.select.size).toBe(true);
        expect(args.select.variants.select.color).toBe(true);
      });
    });

    describe('findAllAdmin (GET /products/admin) — admin path keeps full data', () => {
      beforeEach(() => {
        prismaMock.product.findMany.mockResolvedValue([]);
        prismaMock.product.count.mockResolvedValue(0);
      });

      it('uses `include` (full row + relations) — NOT a restricted select', async () => {
        await service.findAllAdmin({} as any);
        const args = prismaMock.product.findMany.mock.calls[0][0];
        expect(args.include).toBeDefined();
        expect(args.select).toBeUndefined();
      });

      it('does NOT filter by isActive — drafts must be visible to admins', async () => {
        await service.findAllAdmin({} as any);
        const args = prismaMock.product.findMany.mock.calls[0][0];
        expect(args.where.isActive).toBeUndefined();
        // Tenant scope still enforced.
        expect(args.where.tenantId).toBe(TENANT);
      });
    });

    describe('findById (GET /products/by-id/:id) — admin path keeps full data', () => {
      it('uses the full productIncludes (so admin UI + AI agent see inventory fields)', async () => {
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        await service.findById('id1');
        const args = prismaMock.product.findFirst.mock.calls[0][0];
        expect(args.include).toBeDefined();
        expect(args.select).toBeUndefined();
      });
    });
  });

  /**
   * Lifecycle symmetry for the admin shortcut `PATCH /products/:id/
   * toggle-active`. The button bypasses the AI agent's approval flow
   * (admins are trusted at the platform level) but MUST produce the
   * same row shape as the AI write paths so any product is always in
   * one of the four documented lifecycle states (DRAFT / ACTIVE /
   * ARCHIVED / SOFT_DELETED) — see docs/ai-agent/PRODUCT_LIFECYCLE.md.
   *
   * Before the 2026-05-11 lifecycle review, toggleActive only flipped
   * isActive without touching archivedAt. That created two unreachable
   * states:
   *   - ACTIVE → toggle → (isActive=false, archivedAt=null) — looks
   *     like DRAFT but was actually an active product
   *   - ARCHIVED → toggle → (isActive=true, archivedAt=Date) — no
   *     valid state in the matrix
   * The fix mirrors the AI tools' write pattern.
   */
  describe('toggleActive — lifecycle symmetry with AI tools', () => {
    function rawProduct(overrides: any = {}) {
      return {
        id: 'p_x',
        tenantId: TENANT,
        slug: 'p-x',
        name: 'Product X',
        isActive: true,
        archivedAt: null,
        deletedAt: null,
        ...overrides,
      };
    }

    it('ACTIVE → toggleActive stamps archivedAt = Date and clears isActive (lands in ARCHIVED)', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(
        rawProduct({ isActive: true, archivedAt: null }),
      );
      prismaMock.product.update.mockResolvedValueOnce({});
      await service.toggleActive('p_x');
      const args = prismaMock.product.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
      expect(args.data.archivedAt).toBeInstanceOf(Date);
    });

    it('ARCHIVED → toggleActive clears archivedAt and sets isActive (lands in ACTIVE)', async () => {
      // Note: this admin shortcut intentionally bypasses the AI
      // restore_product approval flow. Documented in the lifecycle doc.
      // Lifecycle symmetry: the row lands in a valid documented state.
      prismaMock.product.findFirst.mockResolvedValueOnce(
        rawProduct({ isActive: false, archivedAt: new Date('2026-05-10T10:00:00Z') }),
      );
      prismaMock.product.update.mockResolvedValueOnce({});
      await service.toggleActive('p_x');
      const args = prismaMock.product.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(true);
      expect(args.data.archivedAt).toBeNull();
    });

    it('DRAFT → toggleActive clears archivedAt (idempotent null) and sets isActive (lands in ACTIVE)', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(
        rawProduct({ isActive: false, archivedAt: null }),
      );
      prismaMock.product.update.mockResolvedValueOnce({});
      await service.toggleActive('p_x');
      const args = prismaMock.product.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(true);
      // archivedAt was already null on the row — write keeps it null
      // (the AI restore/publish paths do the same idempotent clear).
      expect(args.data.archivedAt).toBeNull();
    });

    it('does NOT modify deletedAt (toggleActive is never a recycle-bin operation)', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(rawProduct());
      prismaMock.product.update.mockResolvedValueOnce({});
      await service.toggleActive('p_x');
      const args = prismaMock.product.update.mock.calls[0][0];
      expect('deletedAt' in args.data).toBe(false);
    });

    it('rejects toggleActive on a soft-deleted row (admin must restore from recycle-bin first)', async () => {
      prismaMock.product.findFirst.mockResolvedValueOnce(
        rawProduct({ deletedAt: new Date('2026-05-01T00:00:00Z') }),
      );
      await expect(service.toggleActive('p_x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.product.update).not.toHaveBeenCalled();
    });
  });
});
