import { NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PaymentsService } from './payments.service';

// Regression guard (Nov 2026): PATCH /payments/:id (payments:manage) read the
// payment shop-scoped but then wrote it by id alone (`payment.update({ where:
// { id } })`). Not exploitable while the read stays in front of it, but the
// runtime TENANT_SCOPE guard flagged it and any refactor that dropped or
// reordered the read would let one shop's admin rewrite another shop's
// payment. The write itself must now carry the tenant.

function setup(found: any = { id: 'p1', tenantId: 'tenant-a', status: 'PENDING' }, writeCount = 1) {
  const prisma: any = {
    payment: {
      findFirst: jest.fn().mockResolvedValueOnce(found).mockResolvedValue(found ? { ...found, status: 'COMPLETED' } : null),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: writeCount }),
    },
  };
  const settlement = { settleParents: jest.fn() };
  const svc = new PaymentsService(prisma, {} as any, { requireId: 'tenant-a' } as any, settlement as any);
  return { svc, prisma, settlement };
}

describe('PaymentsService.updateStatus — shop-scoped write', () => {
  it('writes with both id AND tenantId, never a by-id update', async () => {
    const { svc, prisma } = setup();
    await svc.updateStatus('p1', { status: 'COMPLETED' } as any);
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.payment.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'p1', tenantId: 'tenant-a' });
  });

  it('the read is shop-scoped too; another shop\'s id → 404, nothing written', async () => {
    const { svc, prisma } = setup(null);
    await expect(svc.updateStatus('p-other-shop', { status: 'COMPLETED' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({ id: 'p-other-shop', tenantId: 'tenant-a' });
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('a row that changed or vanished at write time is refused (404 here; P0c answers 409) and settles nothing', async () => {
    const { svc, settlement } = setup(undefined, 0);
    await expect(svc.updateStatus('p1', { status: 'COMPLETED' } as any)).rejects.toThrow();
    expect(settlement.settleParents).not.toHaveBeenCalled();
  });

  it('legitimate update still returns the payment and settles on COMPLETED', async () => {
    const { svc, settlement } = setup();
    const r: any = await svc.updateStatus('p1', { status: 'COMPLETED' } as any);
    expect(r.status).toBe('COMPLETED');
    expect(settlement.settleParents).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'tenant-a');
  });

  it('source: no by-id payment.update remains in updateStatus', () => {
    const src = readFileSync(join(__dirname, 'payments.service.ts'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('async updateStatus(');
    const body = src.slice(start, src.indexOf('\n  async ', start + 10));
    expect(body).not.toMatch(/payment\.update\(\s*\{\s*where:\s*\{\s*id\s*\}/);
  });
});
