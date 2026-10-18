import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncChangesQueryDto } from './sync-changes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

/** GET /sync/changes — counts drive the client's "Newer data online" badge. */

type Row = { tenantId: string; updatedAt: Date };

function makePrisma(rows: Record<string, Row[]>) {
  const counter = (model: string) => ({
    count: jest.fn(async ({ where }: any) =>
      (rows[model] ?? []).filter(
        (r) => r.tenantId === where.tenantId && r.updatedAt.getTime() > where.updatedAt.gt.getTime(),
      ).length,
    ),
  });
  return {
    product: counter('product'),
    category: counter('category'),
    order: counter('order'),
    rentalOrder: counter('rentalOrder'),
    businessExpense: counter('businessExpense'),
  } as any;
}

const at = (iso: string) => new Date(iso);

describe('SyncService.changes', () => {
  const rows: Record<string, Row[]> = {
    product: [
      { tenantId: 't1', updatedAt: at('2026-10-18T09:00:00Z') },
      { tenantId: 't1', updatedAt: at('2026-10-17T09:00:00Z') }, // before since
      { tenantId: 't2', updatedAt: at('2026-10-18T09:00:00Z') }, // other tenant
    ],
    category: [{ tenantId: 't1', updatedAt: at('2026-10-18T09:30:00Z') }],
    order: [
      { tenantId: 't1', updatedAt: at('2026-10-18T08:00:01Z') },
      { tenantId: 't1', updatedAt: at('2026-10-18T08:30:00Z') },
      { tenantId: 't2', updatedAt: at('2026-10-18T08:30:00Z') },
    ],
    rentalOrder: [],
    businessExpense: [{ tenantId: 't2', updatedAt: at('2026-10-18T09:00:00Z') }],
  };

  it('counts only this tenant’s rows changed after `since`', async () => {
    const prisma = makePrisma(rows);
    const svc = new SyncService(prisma, { requireId: 't1' } as any);
    const now = at('2026-10-18T10:00:00Z');
    const res = await svc.changes('2026-10-18T08:00:00Z', now);
    expect(res).toEqual({
      serverTime: '2026-10-18T10:00:00.000Z',
      since: '2026-10-18T08:00:00.000Z',
      changes: { products: 1, categories: 1, orders: 2, rentals: 0, expenses: 0 },
      total: 4,
    });
    for (const m of ['product', 'category', 'order', 'rentalOrder', 'businessExpense']) {
      expect(prisma[m].count.mock.calls[0][0].where.tenantId).toBe('t1');
      // Soft-deleted rows are deliberately NOT excluded (a delete is a change).
      expect(prisma[m].count.mock.calls[0][0].where.deletedAt).toBeUndefined();
    }
  });

  it('other tenant sees its own counts', async () => {
    const svc = new SyncService(makePrisma(rows), { requireId: 't2' } as any);
    const res = await svc.changes('2026-10-18T08:00:00Z', at('2026-10-18T10:00:00Z'));
    expect(res.changes).toEqual({ products: 1, categories: 0, orders: 1, rentals: 0, expenses: 1 });
  });

  it('clamps a future `since` to server now', async () => {
    const svc = new SyncService(makePrisma(rows), { requireId: 't1' } as any);
    const now = at('2026-10-18T10:00:00Z');
    const res = await svc.changes('2027-01-01T00:00:00Z', now);
    expect(res.since).toBe(now.toISOString());
    expect(res.total).toBe(0);
  });

  it('rejects an invalid since', async () => {
    const svc = new SyncService(makePrisma(rows), { requireId: 't1' } as any);
    await expect(svc.changes('garbage')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DTO: since is required and must be ISO', async () => {
    const errs = async (q: any) => (await validate(plainToInstance(SyncChangesQueryDto, q))).length;
    expect(await errs({})).toBe(1);
    expect(await errs({ since: 'yesterday' })).toBe(1);
    expect(await errs({ since: '2026-10-18T08:00:00.000Z' })).toBe(0);
  });

  it('controller is admin-only (JwtAuthGuard → AdminGuard)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SyncController);
    expect(guards).toEqual([JwtAuthGuard, AdminGuard]);
  });
});
