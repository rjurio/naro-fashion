import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

// Names reserved for the shared system roles. Tenants may not create or
// rename a custom role to one of these (it would shadow the system role in
// name-based checks such as "SUPER_ADMIN may only be assigned by SUPER_ADMIN").
export const RESERVED_ROLE_NAMES = ['SUPER_ADMIN', 'MANAGER', 'STAFF', 'AI_AGENT_OPERATOR', 'AI_AGENT_APPROVER'];

function isReservedRoleName(name?: string | null): boolean {
  if (!name) return false;
  return RESERVED_ROLE_NAMES.includes(name.trim().toUpperCase());
}

// System role seeding lives in SystemRolesSeeder (singleton): this service is
// request-scoped via TenantContext, so lifecycle hooks here never run.
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async findAll(includeDeleted = false) {
    const tenantId = this.tenantContext.requireId;
    return this.prisma.role.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null, isSystem: true }],
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: { _count: { select: { permissions: true, adminUsers: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const tenantId = this.tenantContext.requireId;
    const role = await this.prisma.role.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
      include: { permissions: { include: { permission: true } }, _count: { select: { adminUsers: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const tenantId = this.tenantContext.requireId;
    if (isReservedRoleName(dto.name)) {
      throw new ForbiddenException('This role name is reserved for a system role');
    }
    try {
      const role = await this.prisma.role.create({ data: { name: dto.name, description: dto.description, tenantId } });
      await this.auditService.log('CREATE', 'Role', role.id, { name: dto.name });
      return role;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A role with this name already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateRoleDto) {
    const tenantId = this.tenantContext.requireId;
    const role = await this.prisma.role.findFirst({ where: { id, OR: [{ tenantId }, { tenantId: null, isSystem: true }] } });
    if (!role) throw new NotFoundException('Role not found');
    // System roles (tenantId=null) are SHARED by every tenant — a tenant admin
    // editing one (even just the description) would change it platform-wide.
    if (role.isSystem && !this.tenantContext.isPlatformAdmin) {
      throw new ForbiddenException('Cannot modify system roles');
    }
    if (role.isSystem && dto.name) throw new ForbiddenException('Cannot rename system roles');
    if (dto.name && isReservedRoleName(dto.name)) {
      throw new ForbiddenException('This role name is reserved for a system role');
    }
    try {
      const updated = await this.prisma.role.update({
        where: { id },
        data: { description: dto.description, ...(dto.name ? { name: dto.name } : {}) },
      });
      await this.auditService.log('UPDATE', 'Role', id);
      return updated;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('A role with this name already exists');
      throw e;
    }
  }

  async remove(id: string) {
    const tenantId = this.tenantContext.requireId;
    const role = await this.prisma.role.findFirst({ where: { id, OR: [{ tenantId }, { tenantId: null, isSystem: true }] } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('Cannot delete system roles');
    return this.prisma.role.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  }

  async restore(id: string) {
    const tenantId = this.tenantContext.requireId;
    // Only the owning tenant may restore its own (custom) role. System roles
    // have tenantId=null and are never soft-deleted, so `{ id, tenantId }`
    // naturally excludes them; the isSystem block is defence-in-depth.
    const role = await this.prisma.role.findFirst({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('Cannot restore system roles');
    return this.prisma.role.update({ where: { id }, data: { deletedAt: null, isActive: true } });
  }

  async getRolePermissions(id: string) {
    // Visibility check: the role must be this tenant's own or a shared system
    // role. Without it any admin could enumerate another tenant's role config.
    await this.resolveVisibleRole(id);
    return this.prisma.rolePermission.findMany({
      where: { roleId: id },
      include: { permission: true },
    });
  }

  async addPermissions(id: string, permissionIds: string[]) {
    // Mirror removePermission's guard. Without this, a tenant admin could
    // grant arbitrary permissions to a SHARED system role (tenantId=null,
    // SUPER_ADMIN/MANAGER/STAFF) and escalate privileges platform-wide, or
    // mutate another tenant's custom role by id.
    const role = await this.resolveVisibleRole(id);
    if (role.isSystem) throw new ForbiddenException('Cannot modify permissions on system roles');
    await this.prisma.rolePermission.createMany({
      data: permissionIds.map(pid => ({ roleId: id, permissionId: pid })),
      skipDuplicates: true,
    });
    await this.auditService.log('ADD_PERMISSIONS', 'Role', id);
    return this.getRolePermissions(id);
  }

  // Resolves a role the current tenant is allowed to see: its own, or a shared
  // system role. Throws 404 otherwise (avoids leaking cross-tenant existence).
  private async resolveVisibleRole(id: string) {
    const tenantId = this.tenantContext.requireId;
    const role = await this.prisma.role.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async removePermission(roleId: string, permissionId: string) {
    const tenantId = this.tenantContext.requireId;
    const role = await this.prisma.role.findFirst({ where: { id: roleId, OR: [{ tenantId }, { tenantId: null, isSystem: true }] } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('Cannot remove permissions from system roles');
    await this.prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId } } });
    await this.auditService.log('REMOVE_PERMISSION', 'Role', roleId);
    return { message: 'Permission removed' };
  }
}
