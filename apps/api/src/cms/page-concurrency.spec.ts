import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CmsService, UpdatePageDto } from './cms.service';

/**
 * PATCH /cms/pages/:id with expectedUpdatedAt = atomic compare-and-swap, so a
 * newer edit is never silently overwritten (by another admin, or by the
 * guarded FAQ update script while an editor is saving).
 */
const T0 = new Date('2026-03-19T19:14:59.827Z');
function make(claim = 1) {
  const current = { id: 'pg1', tenantId: 't1', deletedAt: null, updatedAt: new Date('2026-11-12T10:00:00.000Z'), content: '<p>newer</p>' };
  const prisma: any = {
    page: {
      findFirst: jest.fn(async () => current),
      updateMany: jest.fn(async () => ({ count: claim })),
      update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
    },
  };
  const audit = { log: jest.fn() };
  return { svc: new CmsService(prisma, {} as any, { requireId: 't1' } as any, audit as any), prisma, audit, current };
}

describe('CMS page update — optimistic concurrency (expectedUpdatedAt)', () => {
  it('matching version: one conditional updateMany on id + tenant + not deleted + updatedAt', async () => {
    const { svc, prisma, audit } = make(1);
    await svc.updatePage('pg1', { content: '<p>x</p>', expectedUpdatedAt: T0.toISOString() });
    const args = prisma.page.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'pg1', tenantId: 't1', deletedAt: null, updatedAt: T0 });
    expect(args.data).toEqual({ content: '<p>x</p>' }); // expectedUpdatedAt is never written
    expect(prisma.page.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith('UPDATE', 'Page', 'pg1', { versionChecked: true });
  });

  it('page changed since it was read: 409 CONFLICT with the current page, nothing written', async () => {
    const { svc, prisma, current } = make(0);
    let err: any;
    try {
      await svc.updatePage('pg1', { content: '<p>stale</p>', expectedUpdatedAt: T0.toISOString() });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'CONFLICT', current: { id: 'pg1', content: current.content } });
    expect(prisma.page.update).not.toHaveBeenCalled();
  });

  it('omitted: previous behaviour (plain update), so existing clients keep working', async () => {
    const { svc, prisma } = make(1);
    await svc.updatePage('pg1', { isPublished: true });
    expect(prisma.page.updateMany).not.toHaveBeenCalled();
    expect(prisma.page.update).toHaveBeenCalledWith({ where: { id: 'pg1' }, data: { isPublished: true } });
  });

  it('an invalid date is refused (400) before anything is written', async () => {
    const { svc, prisma } = make(1);
    await expect(svc.updatePage('pg1', { content: 'x', expectedUpdatedAt: 'yesterday' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.page.updateMany).not.toHaveBeenCalled();
    expect(prisma.page.update).not.toHaveBeenCalled();
  });

  it('the DTO accepts an ISO expectedUpdatedAt under the global whitelist pipe', async () => {
    const ok = await validate(plainToInstance(UpdatePageDto, { content: 'x', expectedUpdatedAt: T0.toISOString() }), { whitelist: true, forbidNonWhitelisted: true });
    expect(ok).toHaveLength(0);
    const bad = await validate(plainToInstance(UpdatePageDto, { expectedUpdatedAt: 'not a date' }), { whitelist: true, forbidNonWhitelisted: true });
    expect(bad.map((e) => e.property)).toEqual(['expectedUpdatedAt']);
  });

  it('the admin page editor sends the version it opened and keeps the form on a 409', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../../admin/app/dashboard/cms/pages/page.tsx'), 'utf8');
    expect(src).toMatch(/expectedUpdatedAt: editingUpdatedAt/);
    expect(src).toMatch(/setEditingUpdatedAt\(p\.updatedAt/);
    expect(src).toMatch(/err\?\.status === 409/);
  });
});
