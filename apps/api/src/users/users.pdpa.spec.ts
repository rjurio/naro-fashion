import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { UsersService } from './users.service';

/** PDPA data export + suspension revocation (October 2026 review). */
describe('UsersService — PDPA export / no self-deletion', () => {
  const TENANT = 't1';
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn(), update: jest.fn((a: any) => a) },
      address: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
      review: { findMany: jest.fn().mockResolvedValue([]) },
      wishlistItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new UsersService(prisma, { requireId: TENANT, id: TENANT } as any);
  });

  it('export is own-data + tenant scoped and never selects secrets', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'c@x.tz' });
    const out = await service.exportMyData({ id: 'u1' });
    const q = prisma.user.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({ id: 'u1', tenantId: TENANT });
    expect(q.select.passwordHash).toBeUndefined();
    expect(q.select.passwordResetToken).toBeUndefined();
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', tenantId: TENANT });
    expect(prisma.rentalOrder.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', tenantId: TENANT });
    expect(out).toEqual(expect.objectContaining({ profile: { id: 'u1', email: 'c@x.tz' }, orders: [], wishlist: [] }));
  });

  it('export rejects admins and users outside the tenant', async () => {
    await expect(service.exportMyData({ id: 'a1', isAdmin: true })).rejects.toBeInstanceOf(ForbiddenException);
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.exportMyData({ id: 'u-other' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('export turns unexpected failures into a logged 500', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    prisma.order.findMany.mockRejectedValue(new Error('db exploded'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.exportMyData({ id: 'u1' })).rejects.toBeInstanceOf(InternalServerErrorException);
    expect((service as any).logger.error).toHaveBeenCalled();
  });

  it('customers cannot delete their own account (no service method, no route)', () => {
    expect((service as any).deleteMyAccount).toBeUndefined();
    const controller = fs.readFileSync(path.join(__dirname, 'users.controller.ts'), 'utf8');
    expect(controller).not.toMatch(/@Delete\(\s*['"]me['"]\s*\)/);
  });

  it('suspending a customer also bumps tokenVersion', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    await service.suspendUser('u1');
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ isActive: false, tokenVersion: { increment: 1 } });
  });
});
