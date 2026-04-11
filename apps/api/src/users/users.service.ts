import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
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

  async getAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return this.prisma.address.create({
      data: {
        userId,
        fullName: dto.street, // Using street as fallback for fullName
        phone: '', // Required field
        street: dto.street,
        city: dto.city,
        region: dto.state,
        postalCode: dto.zipCode,
        country: dto.country,
        label: dto.label ?? 'Home',
        isDefault: dto.isDefault ?? false,
      },
    });
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
    if (dto.street !== undefined) data.street = dto.street;
    if (dto.city !== undefined) data.city = dto.city;
    if ((dto as any).state !== undefined) data.region = (dto as any).state;
    if ((dto as any).zipCode !== undefined) data.postalCode = (dto as any).zipCode;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    return this.prisma.address.update({
      where: { id: addressId },
      data,
    });
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
