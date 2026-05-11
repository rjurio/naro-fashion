import { PromoCodesService } from './promo-codes.service';

/**
 * PromoCodesService — createdBy attribution regression (2026-05-11).
 *
 * Background: PromoCodesController previously passed `req.user?.sub`
 * (always undefined) as the creator id, so every PromoCode row had
 * `createdBy: null`. Controller now passes `@CurrentUser('id')`.
 */
describe('PromoCodesService.create — createdBy attribution', () => {
  function makeService() {
    const prisma: any = {
      promoCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      },
    };
    const tenantContext: any = { requireId: 'tenant-1' };
    return { service: new PromoCodesService(prisma, tenantContext), prisma };
  }

  it('writes createdBy when caller supplies a user id', async () => {
    const { service, prisma } = makeService();
    await service.create(
      {
        code: 'SAVE10',
        discountType: 'PERCENT' as any,
        discountValue: 10,
      } as any,
      'admin-99',
    );
    const args = prisma.promoCode.create.mock.calls[0][0];
    expect(args.data.createdBy).toBe('admin-99');
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.code).toBe('SAVE10');
  });
});
