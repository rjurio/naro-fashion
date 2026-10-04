import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminUser } from '../auth/util/ownership';
import { TenantContext } from '../tenant/tenant.context';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  // ---- Admin endpoints ----

  async findAllForAdmin(search?: string) {
    const tenantId = this.tenantContext.requireId;
    const where: any = { tenantId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { orders: true, rentalOrders: true } },
      },
    });

    // Compute totals
    const userIds = users.map((u) => u.id);
    const orderTotals = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, tenantId },
      _sum: { total: true },
    });
    const totalMap = new Map(orderTotals.map((o) => [o.userId, Number(o._sum.total ?? 0)]));

    return users.map((u) => {
      const spent = totalMap.get(u.id) ?? 0;
      return {
        id: u.id,
        email: u.email ?? '',
        firstName: u.firstName ?? '',
        lastName: u.lastName ?? '',
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'Unknown',
        phone: u.phone ?? '',
        isActive: u.isActive,
        isVerified: u.isVerified,
        orders: u._count.orders,
        rentals: u._count.rentalOrders,
        totalSpent: spent.toLocaleString('en-TZ', { style: 'currency', currency: 'TZS', minimumFractionDigits: 0 }),
        joined: u.createdAt.toISOString().split('T')[0],
        status: !u.isActive ? 'Suspended' : 'Active',
      };
    });
  }

  async suspendUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: this.tenantContext.requireId },
    });
    if (!user) throw new NotFoundException('Customer not found');

    // Bump tokenVersion so every outstanding token dies immediately
    // (JwtStrategy also re-checks isActive on each request).
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false, tokenVersion: { increment: 1 } },
      select: { id: true, isActive: true },
    });
  }

  async activateUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: this.tenantContext.requireId },
    });
    if (!user) throw new NotFoundException('Customer not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
      select: { id: true, isActive: true },
    });
  }

  // ---- Customer data-subject rights (PDPA) ----

  private assertCustomer(user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean }) {
    if (!user?.id) throw new NotFoundException('User not found');
    if (isAdminUser(user)) {
      throw new ForbiddenException('This endpoint is only available to customer accounts');
    }
  }

  /**
   * `GET /users/me/export` — machine-readable copy of everything held about
   * the calling customer. Strictly own-data: every query is keyed on the
   * caller's id AND the request tenant. Secrets (password hash, reset token,
   * OAuth ids, tokenVersion) are never included.
   */
  async exportMyData(user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean }) {
    this.assertCustomer(user);
    const tenantId = this.tenantContext.requireId;
    const userId = user.id;

    const profile = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        email: true,
        phone: true,
        alternativePhone: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isVerified: true,
        isActive: true,
        preferredTheme: true,
        preferredLocale: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!profile) throw new NotFoundException('User not found');

    const [addresses, orders, rentals, reviews, wishlist] = await Promise.all([
      this.prisma.address.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.order.findMany({
        where: { userId, tenantId },
        include: { items: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.rentalOrder.findMany({
        where: { userId, tenantId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.review.findMany({
        where: { userId, tenantId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.wishlistItem.findMany({
        where: { userId, product: { tenantId } },
        include: { product: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile,
      addresses,
      orders,
      rentals,
      reviews,
      wishlist,
    };
  }

  /**
   * `DELETE /users/me` — right to erasure. Requires the current password.
   * Anonymises the User row instead of hard-deleting it so orders / rentals /
   * payments (FK onDelete: Restrict) remain intact for accounting & tax.
   * Cart + wishlist are deleted; addresses not referenced by any order are
   * deleted (order-linked ones are kept as part of the accounting record).
   * tokenVersion is bumped so every session is revoked.
   */
  async deleteMyAccount(
    user: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean },
    currentPassword: unknown,
  ) {
    this.assertCustomer(user);
    const tenantId = this.tenantContext.requireId;
    const userId = user.id;

    const row = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, passwordHash: true },
    });
    if (!row) throw new NotFoundException('User not found');
    if (!row.passwordHash) {
      throw new BadRequestException(
        'Password confirmation is required. Use "forgot password" to set a password first.',
      );
    }
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, row.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { userId } }),
      this.prisma.wishlistItem.deleteMany({ where: { userId } }),
      this.prisma.address.deleteMany({ where: { userId, orders: { none: {} } } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@invalid`,
          firstName: null,
          lastName: null,
          phone: null,
          alternativePhone: null,
          avatarUrl: null,
          passwordHash: null,
          passwordResetToken: null,
          passwordResetExpires: null,
          googleId: null,
          facebookId: null,
          isVerified: false,
          isActive: false,
          tokenVersion: { increment: 1 },
        },
      }),
    ]);

    return { message: 'Account deleted' };
  }

  // ---- Customer-facing endpoints ----

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, tenantId: this.tenantContext.requireId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatar !== undefined) data.avatarUrl = dto.avatar;

    return this.prisma.user.update({
      where: { id: userId, tenantId: this.tenantContext.requireId },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        updatedAt: true,
      },
    });
  }

  /**
   * The schema uses `region` and `postalCode` (Tanzania-native naming) but
   * the storefront UI uses `state`/`zipCode`. We accept both shapes on input
   * and emit both on output so each side reads the names it expects.
   */
  private serializeAddress<T extends { region?: string | null; postalCode?: string | null }>(
    a: T,
  ): T & { state: string; zipCode: string } {
    return {
      ...a,
      state: a.region ?? '',
      zipCode: a.postalCode ?? '',
    };
  }

  async getAddresses(userId: string) {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serializeAddress(r));
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await this.prisma.address.create({
      data: {
        userId,
        fullName: dto.fullName,
        phone: dto.phone,
        street: dto.street,
        city: dto.city,
        region: dto.state,
        postalCode: dto.zipCode ?? null,
        country: dto.country,
        label: dto.label ?? 'Home',
        isDefault: dto.isDefault ?? false,
      },
    });
    return this.serializeAddress(created);
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.street !== undefined) data.street = dto.street;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.region = dto.state;
    if (dto.zipCode !== undefined) data.postalCode = dto.zipCode;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    const updated = await this.prisma.address.update({
      where: { id: addressId },
      data,
    });
    return this.serializeAddress(updated);
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    await this.prisma.address.delete({
      where: { id: addressId },
    });

    return { message: 'Address deleted' };
  }
}
