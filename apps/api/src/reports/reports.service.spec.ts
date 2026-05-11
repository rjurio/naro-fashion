import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

/**
 * ReportsService — closedBy attribution regression (2026-05-11).
 *
 * Background: ReportsController previously passed `req.user?.sub`
 * (always undefined) as the closer id, so every closed FinancialPeriod
 * row had `closedBy: null`. Audit loss for SOX-style controls. The
 * controller now passes `@CurrentUser('id')`. This test pins the
 * service writes the value through.
 */
describe('ReportsService.closePeriod — closedBy attribution', () => {
  function makeService() {
    const prisma: any = {
      financialPeriod: {
        findFirst: jest.fn().mockResolvedValue({ id: 'period-1', tenantId: 'tenant-1' }),
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
});
