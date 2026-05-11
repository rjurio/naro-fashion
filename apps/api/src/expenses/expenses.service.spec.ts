import { ExpensesService } from './expenses.service';

/**
 * ExpensesService — createdBy attribution regression (2026-05-11).
 *
 * Background: ExpensesController previously passed `req.user?.sub`
 * (always undefined) as the creator id, so every BusinessExpense row
 * had `createdBy: null`. Controller now passes `@CurrentUser('id')`.
 */
describe('ExpensesService.create — createdBy attribution', () => {
  function makeService() {
    const prisma: any = {
      businessExpense: {
        create: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      },
    };
    const tenantContext: any = { requireId: 'tenant-1' };
    return { service: new ExpensesService(prisma, tenantContext), prisma };
  }

  it('writes createdBy when caller supplies a user id', async () => {
    const { service, prisma } = makeService();
    await service.create(
      {
        categoryId: 'cat-1',
        amount: 1000,
        description: 'Rent',
        expenseDate: '2026-05-11' as any,
      } as any,
      'admin-99',
    );
    const args = prisma.businessExpense.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe('admin-99');
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.period).toBe('2026-05');
  });
});
