import { InventoryService } from './inventory.service';

/**
 * InventoryService — performedBy attribution regression (2026-05-11).
 *
 * Background: InventoryController previously passed `req.user?.sub`
 * (always undefined) as the performer id, so every InventoryTransaction
 * row had `performedBy: null`. Stock-adjust audit was anonymous, defeating
 * compliance reviews. The controller now passes `@CurrentUser('id')`.
 * This test pins that the service writes the value through to Prisma.
 */
describe('InventoryService.adjustStock — performedBy attribution', () => {
  function makeService() {
    const txClient = {
      productVariant: { update: jest.fn().mockResolvedValue({}) },
      product: { update: jest.fn().mockResolvedValue({}) },
      inventoryTransaction: {
        create: jest.fn().mockImplementation((args: any) => Promise.resolve(args.data)),
      },
    };
    const prisma: any = {
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'var-1', stock: 10 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { stock: 10 } }),
      },
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'prod-1', purchasePrice: '100' }),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(txClient)),
    };
    const tenantContext: any = { requireId: 'tenant-1' };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new InventoryService(prisma, tenantContext, audit),
      txClient,
      prisma,
    };
  }

  it('writes performedBy to InventoryTransaction when caller supplies a user id', async () => {
    const { service, txClient } = makeService();
    await service.adjustStock(
      {
        productId: 'prod-1',
        variantId: 'var-1',
        type: 'RESTOCK',
        quantity: 5,
        note: 'test',
        reference: 'po-1',
      } as any,
      'admin-99',
    );
    expect(txClient.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    const args = txClient.inventoryTransaction.create.mock.calls[0][0];
    expect(args.data.performedBy).toBe('admin-99');
  });

  it('still records the transaction when performedBy is undefined (pre-existing semantics — no hard 400)', async () => {
    // We're not tightening the contract in this PR. If a future PR
    // promotes this to required, the controller-level @CurrentUser('id')
    // typing already guarantees a defined id on authenticated routes.
    const { service, txClient } = makeService();
    await service.adjustStock(
      {
        productId: 'prod-1',
        variantId: 'var-1',
        type: 'RESTOCK',
        quantity: 5,
      } as any,
      undefined,
    );
    expect(txClient.inventoryTransaction.create).toHaveBeenCalledTimes(1);
    expect(txClient.inventoryTransaction.create.mock.calls[0][0].data.performedBy).toBeUndefined();
  });
});
