import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

/**
 * ReportsService — closedBy attribution regression (2026-05-11).
 *
 * Background: ReportsController previously passed `req.user?.sub`
 * (always undefined) as the closer id, so every closed FinancialPeriod
 * row had `closedBy: null`. The controller now passes `@CurrentUser('id')`.
 */
describe('ReportsService.closePeriod — closedBy attribution', () => {
  function makeService(status = 'OPEN') {
    const prisma: any = {
      financialPeriod: {
        findFirst: jest.fn().mockResolvedValue({ id: 'period-1', tenantId: 'tenant-1', status }),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      },
    };
    const tenantContext: any = { requireId: 'tenant-1' };
    return { service: new ReportsService(prisma, tenantContext), prisma };
  }

  it('writes closedBy + closedAt + status=CLOSED when caller supplies a user id', async () => {
    const { service, prisma } = makeService();
    await service.closePeriod('period-1', 'admin-99');
    expect(prisma.financialPeriod.update).toHaveBeenCalledTimes(1);
    const args = prisma.financialPeriod.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'period-1' });
    expect(args.data.status).toBe('CLOSED');
    expect(args.data.closedBy).toBe('admin-99');
    expect(args.data.closedAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when the period does not belong to the tenant', async () => {
    const { service, prisma } = makeService();
    (prisma.financialPeriod.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.closePeriod('missing', 'admin-99')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.financialPeriod.update).not.toHaveBeenCalled();
  });

  it('refuses to re-close an already CLOSED period (keeps original closer)', async () => {
    const { service, prisma } = makeService('CLOSED');
    await expect(service.closePeriod('period-1', 'admin-2')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.financialPeriod.update).not.toHaveBeenCalled();
  });
});

describe('ReportsService.createFinancialPeriod — DTO whitelist + EAT bounds', () => {
  it('derives bounds from periodKey and never accepts status from the body', async () => {
    const prisma: any = {
      financialPeriod: { create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)) },
    };
    const svc = new ReportsService(prisma, { requireId: 't1' } as any);
    const row: any = await svc.createFinancialPeriod({
      periodKey: '2026-03',
      periodName: 'March 2026',
      status: 'CLOSED', // stray field — must be ignored
    } as any);
    expect(row.status).toBe('OPEN');
    expect(row.tenantId).toBe('t1');
    expect(row.startDate.toISOString()).toBe('2026-02-28T21:00:00.000Z');
    expect(row.endDate.toISOString()).toBe('2026-03-31T20:59:59.999Z');
  });
});

describe('ReportsService.getIncomeStatement — revenue recognition', () => {
  function make() {
    const prisma: any = {
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 100000 } }) },
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 15000 } }) },
      rentalOrder: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalRentalPrice: 50000, lateFee: 5000 } }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          { quantity: 3, refundedQuantity: 1, product: { purchasePrice: 1000 } },
        ]),
      },
      businessExpense: { findMany: jest.fn().mockResolvedValue([]) },
      financialPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { svc: new ReportsService(prisma, { requireId: 't1' } as any), prisma };
  }

  it('keeps partially refunded POS sales, subtracts refunds, uses EAT month bounds', async () => {
    const { svc, prisma } = make();
    const r: any = await svc.getIncomeStatement('2026-03');
    expect(r.salesRevenue).toBe(85000);
    expect(r.rentalRevenue).toBe(55000);
    expect(r.cogs).toBe(2000); // 2 units kept × 1000

    const where = prisma.order.aggregate.mock.calls[0][0].where;
    expect(where.createdAt.gte.toISOString()).toBe('2026-02-28T21:00:00.000Z');
    expect(where.OR).toEqual(
      expect.arrayContaining([{ channel: 'POS', paymentStatus: 'PARTIAL' }]),
    );
    const rentalStatuses = prisma.rentalOrder.aggregate.mock.calls[0][0].where.status.in;
    expect(rentalStatuses).toEqual(expect.arrayContaining(['INSPECTION', 'CLOSED', 'RETURNED', 'ACTIVE']));
    expect(rentalStatuses).not.toContain('CANCELLED');
    expect(rentalStatuses).not.toContain('PENDING_ID_VERIFICATION');
  });
});
