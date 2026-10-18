import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Permission codes excluded from the MANAGER role (SUPER_ADMIN-only by default).
// Keep in sync with the "not granted" list next to MANAGER_DEFAULT_GRANTS in
// permissions.service.ts.
export const MANAGER_EXCLUDED = [
  'admins:create', 'admins:delete', 'roles:manage', 'settings:manage', 'audit:export',
  'payments:manage', 'payment-methods:manage', 'recycle-bin:purge',
];

export const STAFF_CODES = [
  'products:view', 'categories:view', 'orders:view', 'orders:update-status',
  'rentals:view', 'rentals:manage-checklist', 'customers:view',
  'reviews:view', 'analytics:view', 'inventory:view',
];

/**
 * Seeds the shared system roles (SUPER_ADMIN / MANAGER / STAFF, tenantId null).
 *
 * This used to live in RolesService.onModuleInit, but RolesService injects the
 * request-scoped TenantContext, which makes it request-scoped too — and Nest
 * never calls lifecycle hooks on request-scoped providers. The hook silently
 * never ran, so production had no MANAGER/STAFF system roles. This seeder only
 * depends on PrismaService (singleton), so the hook fires. It runs at
 * application bootstrap, after PermissionsService.onModuleInit has upserted
 * the permission catalogue.
 */
@Injectable()
export class SystemRolesSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemRolesSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.seed();
      await this.mergeTenantScopedCopies();
    } catch (err) {
      // Boot must never fail on seeding; next boot retries.
      this.logger.error(`System role seeding failed: ${(err as Error).message}`);
    }
  }

  /**
   * Collapse legacy tenant-scoped copies of the system roles into the shared
   * (tenantId null) row. The multi-tenant migration stamped a tenantId onto
   * the original system roles; `seed()` only looks for tenantId null, so it
   * created a second SUPER_ADMIN next to the tenant copy and the Roles page
   * showed two. Postgres treats NULLs as distinct, so @@unique([tenantId,
   * name]) can't catch it. Admin assignments move to the shared role
   * (duplicates skipped), then the copy and its grants are removed.
   * Idempotent: once merged, nothing matches.
   */
  async mergeTenantScopedCopies() {
    const names = ['SUPER_ADMIN', 'MANAGER', 'STAFF'];
    const copies = await this.prisma.role.findMany({
      where: { name: { in: names }, isSystem: true, tenantId: { not: null } },
      select: { id: true, name: true, tenantId: true },
    });
    for (const copy of copies) {
      const shared = await this.prisma.role.findFirst({
        where: { name: copy.name, isSystem: true, tenantId: null },
        select: { id: true },
      });
      if (!shared) continue; // seed() failed for this name; retry next boot
      const assignments = await this.prisma.adminUserRole.findMany({
        where: { roleId: copy.id },
        select: { adminUserId: true, assignedAt: true, assignedBy: true },
      });
      await this.prisma.$transaction([
        this.prisma.adminUserRole.createMany({
          data: assignments.map((a) => ({ ...a, roleId: shared.id })),
          skipDuplicates: true,
        }),
        this.prisma.adminUserRole.deleteMany({ where: { roleId: copy.id } }),
        this.prisma.rolePermission.deleteMany({ where: { roleId: copy.id } }),
        this.prisma.role.delete({ where: { id: copy.id } }),
      ]);
      this.logger.log(
        `Merged tenant-scoped ${copy.name} (${copy.id}, tenant ${copy.tenantId}) into shared system role ` +
          `${shared.id}; moved ${assignments.length} admin assignment(s)`,
      );
    }
  }

  async seed() {
    const allPermissions = await this.prisma.permission.findMany({ where: { isActive: true } });
    const systemRoles = [
      {
        name: 'SUPER_ADMIN',
        description: 'Full access to all system features',
        permissionIds: allPermissions.map((p) => p.id),
      },
      {
        name: 'MANAGER',
        description: 'Access to all features except admin management and system settings',
        permissionIds: allPermissions.filter((p) => !MANAGER_EXCLUDED.includes(p.code)).map((p) => p.id),
      },
      {
        name: 'STAFF',
        description: 'Read-only access plus checklist and order status management',
        permissionIds: allPermissions.filter((p) => STAFF_CODES.includes(p.code)).map((p) => p.id),
      },
    ];

    for (const role of systemRoles) {
      // Match ONLY the shared system row. A bare `{ name }` lookup could hit a
      // tenant's custom role with the same name and skip seeding entirely.
      const existing = await this.prisma.role.findFirst({
        where: { name: role.name, isSystem: true, tenantId: null },
      });
      if (existing) continue;
      const created = await this.prisma.role.create({
        data: { name: role.name, description: role.description, isSystem: true },
      });
      await this.prisma.rolePermission.createMany({
        data: role.permissionIds.map((pid) => ({ roleId: created.id, permissionId: pid })),
        skipDuplicates: true,
      });
      this.logger.log(`Seeded system role ${role.name} (${role.permissionIds.length} permissions)`);
    }
  }
}
