import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { isActive?: boolean; role?: string; includeDeleted?: boolean }) {
    return this.prisma.adminUser.findMany({
      where: {
        ...(params.includeDeleted ? {} : { deletedAt: null }),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(params.role ? { role: params.role } : {}),
      },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, avatarUrl: true, createdBy: true,
        createdAt: true, failedLoginAttempts: true, lockedUntil: true, deletedAt: true,
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        isActive: true, avatarUrl: true, createdBy: true, createdAt: true,
        failedLoginAttempts: true, lockedUntil: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        activityLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!admin) throw new NotFoundException('Admin user not found');
    return admin;
  }

  async create(dto: CreateAdminUserDto, createdById: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    try {
      const admin = await this.prisma.adminUser.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          role: dto.role || 'STAFF',
          createdBy: createdById,
          ...(dto.roleId ? {
            roles: { create: { roleId: dto.roleId, assignedBy: createdById } },
          } : {}),
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
      // In production: send welcome email with tempPassword
      return { ...admin, temporaryPassword: tempPassword };
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  async update(id: string, dto: UpdateAdminUserDto) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    try {
      return await this.prisma.adminUser.update({
        where: { id },
        data: dto,
        select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  async remove(id: string, performedById: string) {
    if (id === performedById) throw new ForbiddenException('Cannot delete your own account');
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    if (admin.role === 'SUPER_ADMIN') throw new ForbiddenException('Cannot delete SUPER_ADMIN accounts');
    return this.prisma.adminUser.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async toggle(id: string, performedById: string) {
    if (id === performedById) throw new ForbiddenException('Cannot disable your own account');
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    return this.prisma.adminUser.update({
      where: { id },
      data: { isActive: !admin.isActive },
      select: { id: true, isActive: true },
    });
  }

  async unlock(id: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    return this.prisma.adminUser.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
      select: { id: true, failedLoginAttempts: true, lockedUntil: true },
    });
  }

  async assignRole(adminUserId: string, roleId: string, performedById: string) {
    if (adminUserId === performedById) throw new ForbiddenException('Cannot change your own roles');
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'SUPER_ADMIN') {
      const performer = await this.prisma.adminUser.findUnique({ where: { id: performedById } });
      if (performer?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only SUPER_ADMIN can assign the SUPER_ADMIN role');
    }
    try {
      return await this.prisma.adminUserRole.create({ data: { adminUserId, roleId, assignedBy: performedById } });
    } catch (e: any) {
      if (e.code === 'P2002') return { message: 'Role already assigned' };
      throw e;
    }
  }

  async removeRole(adminUserId: string, roleId: string, performedById: string) {
    if (adminUserId === performedById) throw new ForbiddenException('Cannot change your own roles');
    await this.prisma.adminUserRole.delete({ where: { adminUserId_roleId: { adminUserId, roleId } } });
    return { message: 'Role removed' };
  }

  async getActivity(id: string) {
    return this.prisma.adminActivityLog.findMany({
      where: { adminUserId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
