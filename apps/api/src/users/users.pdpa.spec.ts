import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';

/** PDPA data-subject rights + suspension revocation (October 2026 review). */
describe('UsersService — PDPA export / erasure', () => {
  const TENANT = 't1';
  let prisma: any;
  let service: UsersService;
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash('Correct1pass', 4);
  });

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn(), update: jest.fn((a: any) => a) },
      address: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn((a: any) => a) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      rentalOrder: { findMany: jest.fn().mockResolvedValue([]) },
      review: { findMany: jest.fn().mockResolvedValue([]) },
      wishlistItem: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn((a: any) => a) },
      cartItem: { deleteMany: jest.fn((a: any) => a) },
      $transaction: jest.fn().mockResolvedValue([]),
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

  it('delete requires the current password', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash });
    await expect(service.deleteMyAccount({ id: 'u1' }, 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('delete anonymises the user, revokes sessions and keeps orders', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash });
    await expect(service.deleteMyAccount({ id: 'u1' }, 'Correct1pass')).resolves.toEqual({ message: 'Account deleted' });
    const ops = prisma.$transaction.mock.calls[0][0];
    const userUpdate = ops.find((o: any) => o?.data?.email);
    expect(userUpdate.data).toEqual(
      expect.objectContaining({
        email: 'deleted-u1@invalid',
        firstName: null,
        lastName: null,
        phone: null,
        passwordHash: null,
        isActive: false,
        tokenVersion: { increment: 1 },
      }),
    );
    // only addresses NOT referenced by an order are deleted
    const addrDelete = ops.find((o: any) => o?.where?.orders);
    expect(addrDelete.where).toEqual({ userId: 'u1', orders: { none: {} } });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('delete rejects admins', async () => {
    await expect(service.deleteMyAccount({ id: 'a1', isAdmin: true }, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('suspending a customer also bumps tokenVersion', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    await service.suspendUser('u1');
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ isActive: false, tokenVersion: { increment: 1 } });
  });
});
