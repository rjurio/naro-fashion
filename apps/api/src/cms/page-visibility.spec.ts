import { readFileSync } from 'fs';
import { join } from 'path';
import { CmsService, PUBLIC_PAGE_LIST_SELECT } from './cms.service';

// Regression guard (Nov 2026): the @Public() GET /cms/pages returned every
// non-deleted page of the shop — drafts included, with their full content —
// to anyone holding the shop's tenant id (exposed in the storefront cookie).
// The public list now returns published pages with display fields only; the
// admin editor reads its list (drafts included) from GET /cms/pages/admin.

function service() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma: any = { page: { findMany } };
  const svc = new CmsService(prisma, {} as any, { requireId: 'tenant-a' } as any, {} as any);
  return { svc, findMany };
}

describe('public CMS page list', () => {
  it('returns published, non-deleted pages of the current shop only', async () => {
    const { svc, findMany } = service();
    await svc.findPublishedPages();
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'tenant-a', isPublished: true, deletedAt: null });
  });

  it('selects display fields only — never the page body', async () => {
    const { svc, findMany } = service();
    await svc.findPublishedPages();
    const { select } = findMany.mock.calls[0][0];
    expect(select).toBe(PUBLIC_PAGE_LIST_SELECT);
    expect(Object.keys(select).sort()).toEqual(['id', 'isPublished', 'slug', 'title', 'titleSwahili', 'updatedAt']);
    expect(select).not.toHaveProperty('content');
    expect(select).not.toHaveProperty('contentSwahili');
  });

  it('the admin list keeps drafts for the editor (still shop-scoped, deleted excluded)', async () => {
    const { svc, findMany } = service();
    await svc.findAllPages();
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 'tenant-a', deletedAt: null });
  });
});

describe('CmsController page routes (source shape)', () => {
  const src = readFileSync(join(__dirname, 'cms.controller.ts'), 'utf8').replace(/\r\n/g, '\n');
  /** The decorator block + handler body for a route path. */
  function route(path: string) {
    const at = src.indexOf(`@Get('${path}')`);
    expect(at).toBeGreaterThan(-1);
    const start = src.lastIndexOf('\n\n', at);
    const end = src.indexOf('\n  }\n', at);
    return { at, text: src.slice(start, end) };
  }

  it('the @Public() GET pages handler calls findPublishedPages, never findAllPages', () => {
    const r = route('pages');
    expect(r.text).toContain('@Public()');
    expect(r.text).toContain('findPublishedPages()');
    expect(r.text).not.toContain('findAllPages');
  });

  it('GET pages/admin is admin-guarded, not public, and declared before pages/:slug', () => {
    const admin = route('pages/admin');
    expect(admin.text).toMatch(/@UseGuards\(JwtAuthGuard, AdminGuard/);
    expect(admin.text).not.toContain('@Public()');
    expect(admin.text).toContain('findAllPages()');
    expect(admin.at).toBeLessThan(route('pages/:slug').at);
  });

  it('only the admin route returns findAllPages()', () => {
    expect(src.match(/cmsService\.findAllPages\(\)/g)).toHaveLength(1);
  });
});
