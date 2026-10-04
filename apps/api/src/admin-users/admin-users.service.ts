import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

/** The authenticated caller (req.user from JwtStrategy). */
export interface AdminActor {
  id: string;
  role?: string | null;
  isPlatformAdmin?: boolean;
}

const SUPER_ADMIN = 'SUPER_ADMIN';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * True when the caller may grant / modify SUPER_ADMIN: platform admins, or
   * an in-tenant AdminUser whose CURRENT (DB) role string is SUPER_ADMIN.
   * The DB is re-read rather than trusting a JWT claim.
   */
  private async isSuperActor(actor: AdminActor | undefined, tenantId: string): Promise<boolean> {
    if (!actor?.id) return false;
    if (actor.isPlatformAdmin) return true;
    const performer = await this.prisma.adminUser.findFirst({
      where: { id: actor.id, tenantId, deletedAt: null, isActive: true },
      select: { role: true },
    });
    return performer?.role === SUPER_ADMIN;
  }

  /**
   * Resolve a role the caller may assign in this tenant: the tenant's own
   * (non-deleted) role, or a shared system role. Another tenant's role id →
   * 404. The SUPER_ADMIN system role (or any role named SUPER_ADMIN) requires
   * a super actor.
   */
  private async resolveAssignableRole(
    roleId: string,
    tenantId: string,
    actor: AdminActor | undefined,
    superCache: { value?: boolean },
  ) {
    // assignRole's body is an inline type (no ValidationPipe) — never let a
    // non-string (e.g. a Prisma operator object) reach the where-clause.
    if (typeof roleId !== 'string' || !roleId) throw new NotFoundException('Role not found');
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        deletedAt: null,
        OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === SUPER_ADMIN) {
      if (superCache.value === undefined) superCache.value = await this.isSuperActor(actor, tenantId);
      if (!superCache.value) {
        throw new ForbiddenException('Only SUPER_ADMIN can assign the SUPER_ADMIN role');
      }
    }
    return role;
  }

  async findAll(params: { isActive?: boolean; role?: string; includeDeleted?: boolean }) {
    return this.prisma.adminUser.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
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
      where: { id, tenantId: this.tenantContext.requireId },
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

  async create(dto: CreateAdminUserDto, createdById: string, actor?: AdminActor) {
    const tenantId = this.tenantContext.requireId;
    const actorRef: AdminActor = actor ?? { id: createdById };
    const superCache: { value?: boolean } = {};

    const roleString = dto.role || 'STAFF';
    if (roleString === SUPER_ADMIN) {
      superCache.value = await this.isSuperActor(actorRef, tenantId);
      if (!superCache.value) {
        throw new ForbiddenException('Only SUPER_ADMIN can create a SUPER_ADMIN account');
      }
    }

    // Every requested role must be this tenant's own or a shared system role
    // (never another tenant's), and SUPER_ADMIN needs a super actor.
    const roleIds = Array.from(
      new Set([...(dto.roleIds ?? []), ...(dto.roleId ? [dto.roleId] : [])].filter(Boolean)),
    );
    for (const rid of roleIds) {
      await this.resolveAssignableRole(rid, tenantId, actorRef, superCache);
    }

    const existing = await this.prisma.adminUser.findFirst({ where: { email: dto.email, tenantId } });
    if (existing) throw new ConflictException('Email already in use');

    const generated = dto.password ? null : crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(dto.password ?? (generated as string), 12);

    try {
      const admin = await this.prisma.adminUser.create({
        data: {
          tenantId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
          role: roleString,
          createdBy: createdById,
          ...(roleIds.length > 0
            ? { roles: { create: roleIds.map((roleId) => ({ roleId, assignedBy: createdById })) } }
            : {}),
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
      // In production: send welcome email with the temporary password
      return generated ? { ...admin, temporaryPassword: generated } : admin;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  async update(id: string, dto: UpdateAdminUserDto, actor?: AdminActor) {
    const tenantId = this.tenantContext.requireId;
    const admin = await this.prisma.adminUser.findUnique({ where: { id, tenantId } });
    if (!admin) throw new NotFoundException('Admin user not found');

    // Touching a SUPER_ADMIN account (email/password takeover) or granting
    // SUPER_ADMIN requires a super actor.
    if (admin.role === SUPER_ADMIN || dto.role === SUPER_ADMIN) {
      if (!(await this.isSuperActor(actor, tenantId))) {
        throw new ForbiddenException('Only SUPER_ADMIN can modify SUPER_ADMIN accounts or grant SUPER_ADMIN');
      }
    }

    // Explicit whitelist — never spread the DTO straight into Prisma.
    const data: Record<string, any> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
      data.tokenVersion = { increment: 1 }; // revoke the target's sessions
    }

    try {
      return await this.prisma.adminUser.update({
        where: { id },
        data,
        select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  async remove(id: string, performedById: string) {
    if (id === performedById) throw new ForbiddenException('Cannot delete your own account');
    const admin = await this.prisma.adminUser.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!admin) throw new NotFoundException('Admin user not found');
    if (admin.role === 'SUPER_ADMIN') throw new ForbiddenException('Cannot delete SUPER_ADMIN accounts');
    return this.prisma.adminUser.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async toggle(id: string, performedById: string, actor?: AdminActor) {
    if (id === performedById) throw new ForbiddenException('Cannot disable your own account');
    const tenantId = this.tenantContext.requireId;
    const admin = await this.prisma.adminUser.findUnique({ where: { id, tenantId } });
    if (!admin) throw new NotFoundException('Admin user not found');
    if (admin.role === SUPER_ADMIN && !(await this.isSuperActor(actor ?? { id: performedById }, tenantId))) {
      throw new ForbiddenException('Only SUPER_ADMIN can enable/disable SUPER_ADMIN accounts');
    }
    return this.prisma.adminUser.update({
      where: { id },
      data: { isActive: !admin.isActive },
      select: { id: true, isActive: true },
    });
  }

  async unlock(id: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!admin) throw new NotFoundException('Admin user not found');
    return this.prisma.adminUser.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
      select: { id: true, failedLoginAttempts: true, lockedUntil: true },
    });
  }

  async assignRole(adminUserId: string, roleId: string, performedById: string, actor?: AdminActor) {
    const tenantId = this.tenantContext.requireId;
    if (adminUserId === performedById) throw new ForbiddenException('Cannot change your own roles');
    // The TARGET admin must belong to the caller's tenant. Without this a
    // tenant-A SUPER_ADMIN could grant/revoke roles on tenant-B's admins by id.
    const targetAdmin = await this.prisma.adminUser.findFirst({ where: { id: adminUserId, tenantId } });
    if (!targetAdmin) throw new NotFoundException('Admin user not found');
    // System roles (e.g. AI_AGENT_OPERATOR, AI_AGENT_APPROVER, SUPER_ADMIN,
    // MANAGER, STAFF) are seeded with `tenantId: null, isSystem: true` and
    // shared across every tenant. Custom roles are tenant-scoped. The
    // findFirst below matches either shape — same pattern used by
    // RolesService.findAll() when surfacing roles in the admin UI.
    // Without this the AI role-assignment workflow can't find the
    // seeded roles by id.
    // Soft-deleted roles are not assignable; SUPER_ADMIN requires a super actor.
    await this.resolveAssignableRole(roleId, tenantId, actor ?? { id: performedById }, {});
    try {
      return await this.prisma.adminUserRole.create({ data: { adminUserId, roleId, assignedBy: performedById } });
    } catch (e: any) {
      if (e.code === 'P2002') return { message: 'Role already assigned' };
      throw e;
    }
  }

  async removeRole(adminUserId: string, roleId: string, performedById: string) {
    const tenantId = this.tenantContext.requireId;
    if (adminUserId === performedById) throw new ForbiddenException('Cannot change your own roles');
    // Target admin must be in the caller's tenant (see assignRole).
    const targetAdmin = await this.prisma.adminUser.findFirst({ where: { id: adminUserId, tenantId } });
    if (!targetAdmin) throw new NotFoundException('Admin user not found');
    await this.prisma.adminUserRole.delete({ where: { adminUserId_roleId: { adminUserId, roleId } } });
    return { message: 'Role removed' };
  }

  async getActivity(id: string) {
    return this.prisma.adminActivityLog.findMany({
      where: { adminUserId: id, tenantId: this.tenantContext.requireId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
