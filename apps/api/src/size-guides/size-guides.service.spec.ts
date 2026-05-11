import { NotFoundException } from '@nestjs/common';
import { SizeGuidesService } from './size-guides.service';

/**
 * SizeGuidesService unit tests — focused on the 2026-05-10 hotfix that
 * pushes `isActive: true` and `deletedAt: null` into the WHERE clause
 * of the public `findBySlug` method. Same bug pattern as the products
 * fix shipped earlier the same day.
 *
 * The two methods under test:
 *   - `findBySlug(slug)` — wired to the @Public() @Get('by-slug/:slug')
 *     route. MUST exclude inactive (draft) and soft-deleted guides.
 *   - `findById(id)`    — wired to the admin route (@UseGuards
 *     (JwtAuthGuard) @Get(':id')). MUST continue to return drafts so
 *     admins can edit/inspect them before activation.
 *
 * All tests run against a mocked Prisma client — no DB, no Nest boot.
 */

describe('SizeGuidesService — public vs admin guide lookup', () => {
  let prismaMock: any;
  let tenantContextMock: any;
  let service: SizeGuidesService;

  const TENANT = 'tenant_t1';
  const OTHER_TENANT = 'tenant_t2';

  function activeGuide(overrides: any = {}) {
    return {
      id: 'g_active',
      tenantId: TENANT,
      slug: 'active-size-guide',
      name: 'Active Size Guide',
      content: '# Sizes\n\nM L XL',
      isActive: true,
      isDefault: false,
      deletedAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaMock = {
      sizeGuide: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    tenantContextMock = { requireId: TENANT };
    service = new SizeGuidesService(prismaMock, tenantContextMock);
  });

  describe('findBySlug — PUBLIC route, drafts MUST NOT leak', () => {
    it('returns the guide when active + not deleted', async () => {
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
      const result = await service.findBySlug('active-size-guide');
      expect(result.id).toBe('g_active');
      // The public select intentionally drops `isActive` from the response —
      // it's redundant (always true for what survives the WHERE clause) and
      // is admin-only metadata. WHERE-clause assertion lives below.
    });

    it('throws 404 for an inactive (DRAFT) size guide — was the bug', async () => {
      // Filter excludes drafts → findFirst returns null
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(null);
      await expect(service.findBySlug('draft-guide')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 for a soft-deleted size guide', async () => {
      // Filter excludes deletedAt != null → findFirst returns null
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.findBySlug('deleted-guide'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when slug does not exist at all', async () => {
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(null);
      await expect(service.findBySlug('nope')).rejects.toBeInstanceOf(
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
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
      await service.findBySlug('any-slug');

      expect(prismaMock.sizeGuide.findFirst).toHaveBeenCalledTimes(1);
      const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
      expect(args.where.slug).toBe('any-slug');
      expect(args.where.isActive).toBe(true);
      expect(args.where.deletedAt).toBeNull();
    });

    it('respects tenant scoping — uses tenantContext.requireId in the where clause', async () => {
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
      await service.findBySlug('any-slug');
      const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
      expect(args.where.tenantId).toBe(TENANT);
    });

    it('cross-tenant: tenant A cannot fetch tenant B\'s active guide by slug', async () => {
      // Simulate Prisma: a row owned by OTHER_TENANT does not match
      // because the where clause carries TENANT.
      prismaMock.sizeGuide.findFirst.mockImplementationOnce((args: any) => {
        const fakeRow = activeGuide({ tenantId: OTHER_TENANT });
        if (args.where.tenantId !== fakeRow.tenantId) return null;
        return fakeRow;
      });
      await expect(
        service.findBySlug('cross-tenant-slug'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findById — ADMIN route, drafts MUST remain visible', () => {
    it('returns inactive (draft) guide for admins', async () => {
      const draft = activeGuide({ id: 'g_draft', isActive: false });
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(draft);
      const result = await service.findById('g_draft');
      expect(result.id).toBe('g_draft');
      expect(result.isActive).toBe(false);
    });

    it('still throws 404 for a soft-deleted guide', async () => {
      // Admin route's existing post-fetch deletedAt check still applies.
      const deleted = activeGuide({ deletedAt: new Date() });
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(deleted);
      await expect(service.findById('g_active')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does NOT add isActive to the admin where clause (drafts deliberately visible)', async () => {
      prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
      await service.findById('g_active');
      const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
      // The fix targets findBySlug ONLY. findById must keep its existing
      // shape so admins see drafts (Phase 2 contract — drafts are
      // forced isActive=false and require admin review before publish).
      expect(args.where.isActive).toBeUndefined();
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.where.id).toBe('g_active');
    });
  });

  describe('public vs admin contract — explicit summary', () => {
    it('findBySlug WHERE clause is stricter than findById WHERE clause', async () => {
      prismaMock.sizeGuide.findFirst.mockResolvedValue(activeGuide());

      await service.findBySlug('s');
      const slugWhere = prismaMock.sizeGuide.findFirst.mock.calls[0][0].where;

      await service.findById('id1');
      const idWhere = prismaMock.sizeGuide.findFirst.mock.calls[1][0].where;

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
   * Public size-guide endpoints (`findAllPublic`, `findDefault`,
   * `findBySlug`) must NOT leak admin/internal columns: `tenantId`,
   * `isActive`, `isDefault`, `deletedAt`, `createdAt`, `updatedAt`.
   * Storefront only needs id, slug, names, content, PDF urls. The admin
   * path keeps full row access for the recycle bin and toggle UIs.
   */
  describe('Response whitelist — public must not leak admin/internal fields', () => {
    const ADMIN_ONLY_FIELDS = [
      'tenantId',
      'isActive',
      'isDefault',
      'deletedAt',
      'createdAt',
      'updatedAt',
    ] as const;

    const STOREFRONT_REQUIRED_FIELDS = [
      'id',
      'slug',
      'name',
      'nameSwahili',
      'content',
      'contentSwahili',
      'pdfUrl',
      'pdfUrlSwahili',
    ] as const;

    describe('findAllPublic (GET /size-guides)', () => {
      beforeEach(() => prismaMock.sizeGuide.findMany.mockResolvedValue([]));

      it.each(ADMIN_ONLY_FIELDS)('does NOT include %s', async (field) => {
        await service.findAllPublic();
        const args = prismaMock.sizeGuide.findMany.mock.calls[0][0];
        expect(args.select).toBeDefined();
        expect(args.select[field]).toBeUndefined();
      });

      it.each(STOREFRONT_REQUIRED_FIELDS)(
        'DOES include %s — storefront needs it',
        async (field) => {
          await service.findAllPublic();
          const args = prismaMock.sizeGuide.findMany.mock.calls[0][0];
          expect(args.select[field]).toBe(true);
        },
      );

      it('still scopes by tenant + isActive + deletedAt', async () => {
        await service.findAllPublic();
        const args = prismaMock.sizeGuide.findMany.mock.calls[0][0];
        expect(args.where.tenantId).toBe(TENANT);
        expect(args.where.isActive).toBe(true);
        expect(args.where.deletedAt).toBeNull();
      });
    });

    describe('findBySlug (GET /size-guides/by-slug/:slug)', () => {
      it.each(ADMIN_ONLY_FIELDS)('does NOT include %s', async (field) => {
        prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
        await service.findBySlug('s');
        const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
        expect(args.select).toBeDefined();
        expect(args.select[field]).toBeUndefined();
      });

      it.each(STOREFRONT_REQUIRED_FIELDS)(
        'DOES include %s',
        async (field) => {
          prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
          await service.findBySlug('s');
          const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
          expect(args.select[field]).toBe(true);
        },
      );
    });

    describe('findDefault (GET /size-guides/default)', () => {
      it('uses the public select on the primary lookup', async () => {
        prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
        await service.findDefault();
        const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
        expect(args.select.tenantId).toBeUndefined();
        expect(args.select.id).toBe(true);
        expect(args.select.content).toBe(true);
      });

      it('uses the public select on the fallback lookup too', async () => {
        // First call (isDefault: true) returns null → fallback to first active.
        prismaMock.sizeGuide.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(activeGuide());
        await service.findDefault();
        // Second call is the fallback path.
        const args = prismaMock.sizeGuide.findFirst.mock.calls[1][0];
        expect(args.select.tenantId).toBeUndefined();
        expect(args.select.id).toBe(true);
      });
    });

    describe('findAll / findById — ADMIN paths keep full data', () => {
      it('findById does NOT apply the public select (admin sees all fields)', async () => {
        prismaMock.sizeGuide.findFirst.mockResolvedValueOnce(activeGuide());
        await service.findById('id1');
        const args = prismaMock.sizeGuide.findFirst.mock.calls[0][0];
        expect(args.select).toBeUndefined();
      });
    });
  });
});
