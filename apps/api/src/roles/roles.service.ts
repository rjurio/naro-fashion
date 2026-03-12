import { Injectable, OnModuleInit, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

// permission codes excluded from MANAGER role
const MANAGER_EXCLUDED = ['admins:create', 'admins:delete', 'roles:manage', 'settings:manage', 'audit:export'];

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedSystemRoles();
  }

  private async seedSystemRoles() {
    const allPermissions = await this.prisma.permission.findMany({ where: { isActive: true } });
    const allCodes = allPermissions.map(p => p.id);
    const managerCodes = allPermissions.filter(p => !MANAGER_EXCLUDED.includes(p.code)).map(p => p.id);
    const staffCodes = allPermissions.filter(p =>
      [
        'products:view', 'categories:view', 'orders:view', 'orders:update-status',
        'rentals:view', 'rentals:manage-checklist', 'customers:view',
        'reviews:view', 'analytics:view', 'inventory:view',
      ].includes(p.code)
    ).map(p => p.id);

    const systemRoles = [
      { name: 'SUPER_ADMIN', description: 'Full access to all system features', permissionIds: allCodes },
      { name: 'MANAGER', description: 'Access to all features except admin management and system settings', permissionIds: managerCodes },
      { name: 'STAFF', description: 'Read-only access plus checklist and order status management', permissionIds: staffCodes },
    ];

    for (const role of systemRoles) {
      const existing = await this.prisma.role.findUnique({ where: { name: role.name } });
      if (!existing) {
        const created = await this.prisma.role.create({
          data: { name: role.name, description: role.description, isSystem: true },
        });
        await this.prisma.rolePermission.createMany({
          data: role.permissionIds.map(pid => ({ roleId: created.id, permissionId: pid })),
          skipDuplicates: true,
        });
      }
    }
  }

  async findAll(includeDeleted = false) {
    return this.prisma.role.findMany({
      where: { ...(includeDeleted ? {} : { deletedAt: null }) },
      include: { _count: { select: { permissions: true, adminUsers: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } }, _count: { select: { adminUsers: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto) {
    try {
      return await this.prisma.role.create({ data: { name: dto.name, description: dto.description } });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A role with this name already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem && dto.name) throw new ForbiddenException('Cannot rename system roles');
    try {
      return await this.prisma.role.update({
        where: { id },
        data: { description: dto.description, ...(dto.name ? { name: dto.name } : {}) },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A role with this name already exists');
      throw e;
    }
  }

  async remove(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('Cannot delete system roles');
    return this.prisma.role.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async restore(id: string) {
    return this.prisma.role.update({ where: { id }, data: { deletedAt: null, isActive: true } });
  }

  async getRolePermissions(id: string) {
    return this.prisma.rolePermission.findMany({
      where: { roleId: id },
      include: { permission: true },
    });
  }

  async addPermissions(id: string, permissionIds: string[]) {
    await this.prisma.rolePermission.createMany({
      data: permissionIds.map(pid => ({ roleId: id, permissionId: pid })),
      skipDuplicates: true,
    });
    return this.getRolePermissions(id);
  }

  async removePermission(roleId: string, permissionId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('Cannot remove permissions from system roles');
    await this.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId } } });
    return { message: 'Permission removed' };
  }
}
