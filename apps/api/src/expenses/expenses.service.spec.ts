import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpensesService, toPeriod } from './expenses.service';

function makeService(opts: { lockedPeriod?: string; categoryFound?: boolean } = {}) {
  const prisma: any = {
    businessExpense: {
      create: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      update: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      delete: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'e1', period: '2026-03', categoryId: 'cat-1' }),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue(opts.categoryFound === false ? null : { id: 'cat-1' }),
    },
    financialPeriod: {
      findFirst: jest.fn().mockImplementation((args: any) =>
        Promise.resolve(
          args.where.periodKey === opts.lockedPeriod
            ? { periodKey: opts.lockedPeriod, status: 'CLOSED' }
            : null,
        ),
      ),
    },
  };
  const tenantContext: any = { requireId: 'tenant-1' };
  return { service: new ExpensesService(prisma, tenantContext), prisma };
}

/**
 * ExpensesService — createdBy attribution regression (2026-05-11).
 * Controller passes `@CurrentUser('id')`; the service must write it through.
 */
describe('ExpensesService.create — createdBy attribution', () => {
  it('writes createdBy when caller supplies a user id', async () => {
    const { service, prisma } = makeService();
    await service.create(
      { categoryId: 'cat-1', amount: 1000, description: 'Rent', expenseDate: '2026-05-11' } as any,
      'admin-99',
    );
    const args = prisma.businessExpense.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe('admin-99');
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.period).toBe('2026-05');
  });
});

describe('ExpensesService — closed financial periods are enforced', () => {
  it('rejects creating an expense dated in a CLOSED period', async () => {
    const { service, prisma } = makeService({ lockedPeriod: '2026-03' });
    await expect(
      service.create({ categoryId: 'cat-1', amount: 1, expenseDate: '2026-03-15' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.businessExpense.create).not.toHaveBeenCalled();
    expect(prisma.financialPeriod.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-1');
  });

  it('rejects editing or deleting an expense that sits in a CLOSED period', async () => {
    const { service, prisma } = makeService({ lockedPeriod: '2026-03' });
    await expect(service.update('e1', { amount: 5 } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove('e1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.businessExpense.update).not.toHaveBeenCalled();
    expect(prisma.businessExpense.delete).not.toHaveBeenCalled();
  });

  it('rejects moving an open-period expense INTO a closed period', async () => {
    const { service } = makeService({ lockedPeriod: '2026-04' });
    await expect(
      service.update('e1', { expenseDate: '2026-04-02' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows changes in an open period', async () => {
    const { service, prisma } = makeService({ lockedPeriod: '2026-01' });
    await service.update('e1', { amount: 5 } as any);
    expect(prisma.businessExpense.update).toHaveBeenCalled();
  });

  it('rejects a category from another tenant', async () => {
    const { service, prisma } = makeService({ categoryFound: false });
    await expect(
      service.create({ categoryId: 'foreign', amount: 1, expenseDate: '2026-05-01' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expenseCategory.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign',
      tenantId: 'tenant-1',
    });
  });
});

describe('toPeriod — EAT month boundary', () => {
  it('00:30 EAT on the 1st belongs to the new month even though UTC is still the previous month', () => {
    expect(toPeriod('2026-03-31T21:30:00Z')).toBe('2026-04');
    expect(toPeriod('2026-03-31T20:59:00Z')).toBe('2026-03');
  });
});
