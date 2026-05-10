import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_AGENT_ROLE_NAMES,
  AI_PERMISSION_CODES,
  AiPermissionCode,
} from '../types/ai-permissions.types';

/**
 * AI roles seeder — Phase 3.0.
 *
 * Runs once at application bootstrap (after PermissionsService and
 * RolesService have completed their own seeding). Idempotent — safe to
 * run on every boot. Does NOT assign these roles to any AdminUser;
 * operators do that explicitly via /dashboard/settings/roles.
 *
 * Seeds:
 *   1. AI_AGENT_OPERATOR (system role, tenantId=null, isSystem=true)
 *      → ai-agent:use, :read, :write-drafts
 *   2. AI_AGENT_APPROVER (system role, tenantId=null, isSystem=true)
 *      → ai-agent:use, :read, :approve
 *
 * Plus a one-time-by-default-but-idempotent backfill:
 *   3. SUPER_ADMIN gets ai-agent:read, :write-drafts, :approve
 *      (it already has :use from existing seeding paths). This is the
 *      Phase 3.0 rollout-compatibility grant. The Phase 3.2 demotion
 *      script removes :approve from SUPER_ADMIN as the long-term policy.
 *      See PHASE_3_DESIGN.md Decision Log #2.
 *
 * The seeder uses OnApplicationBootstrap (not OnModuleInit) so it runs
 * after every module's init hooks, guaranteeing the permissions and the
 * SUPER_ADMIN role exist before this code touches them.
 */
@Injectable()
export class AiRolesSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiRolesSeederService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedAiSystemRoles();
      await this.backfillSuperAdmin();
    } catch (err: any) {
      // Seeding failure should never break boot. The next deploy will retry.
      this.logger.warn(
        `AI roles seeding failed (will retry on next boot): ${err?.message ?? err}`,
      );
    }
  }

  private async permissionIdsByCode(
    codes: ReadonlyArray<AiPermissionCode>,
  ): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({
      where: { code: { in: codes as unknown as string[] } },
      select: { id: true, code: true },
    });
    if (rows.length !== codes.length) {
      const found = new Set(rows.map((r) => r.code));
      const missing = codes.filter((c) => !found.has(c));
      throw new Error(
        `AI permissions not yet seeded: ${missing.join(', ')}. PermissionsService.onModuleInit must run first.`,
      );
    }
    return rows.map((r) => r.id);
  }

  private async seedAiSystemRoles(): Promise<void> {
    const definitions: Array<{
      name: string;
      description: string;
      permissionCodes: ReadonlyArray<AiPermissionCode>;
    }> = [
      {
        name: AI_AGENT_ROLE_NAMES.OPERATOR,
        description:
          'AI agent operator — can search the agent surface, create drafts, and add notes. Cannot approve risky actions.',
        permissionCodes: [
          AI_PERMISSION_CODES.USE,
          AI_PERMISSION_CODES.READ,
          AI_PERMISSION_CODES.WRITE_DRAFTS,
        ],
      },
      {
        name: AI_AGENT_ROLE_NAMES.APPROVER,
        description:
          'AI agent approver — can review and approve risky actions opened by operators. Cannot initiate writes.',
        permissionCodes: [
          AI_PERMISSION_CODES.USE,
          AI_PERMISSION_CODES.READ,
          AI_PERMISSION_CODES.APPROVE,
        ],
      },
    ];

    for (const def of definitions) {
      const permissionIds = await this.permissionIdsByCode(def.permissionCodes);

      // Match the existing system-role pattern in RolesService.seedSystemRoles:
      // tenantId=null, isSystem=true. Findable per-tenant via the
      // OR: [{ tenantId }, { tenantId: null, isSystem: true }] convention.
      let role = await this.prisma.role.findFirst({
        where: { name: def.name, isSystem: true, tenantId: null },
      });

      if (!role) {
        role = await this.prisma.role.create({
          data: {
            name: def.name,
            description: def.description,
            isSystem: true,
            isActive: true,
          },
        });
        this.logger.log(`Created AI system role: ${def.name}`);
      }

      // Idempotent grant — skipDuplicates handles re-boots.
      const grants = permissionIds.map((permissionId) => ({
        roleId: role!.id,
        permissionId,
      }));
      await this.prisma.rolePermission.createMany({
        data: grants,
        skipDuplicates: true,
      });
    }
  }

  /**
   * Phase 3.0 rollout-compatibility backfill (Decision Log #2). SUPER_ADMIN
   * already has :use from the existing RolesService seeding (which grants
   * all active permissions on first creation). On installs that predate
   * the Phase 3.0 permission codes, those new codes are NOT auto-granted
   * — RolesService skips re-seeding when the role already exists. This
   * backfill closes that gap by always upserting the four AI permission
   * grants on SUPER_ADMIN.
   *
   * Phase 3.2 will REMOVE :approve from SUPER_ADMIN via a separate one-off
   * migration script. End state — AI approval rights must be intentionally
   * granted via AI_AGENT_APPROVER, not implicit through SUPER_ADMIN.
   */
  private async backfillSuperAdmin(): Promise<void> {
    const superAdmin = await this.prisma.role.findFirst({
      where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null },
    });
    if (!superAdmin) {
      // RolesService hasn't seeded SUPER_ADMIN yet (fresh install where
      // OnModuleInit ordering surprised us). Next boot will fix it.
      return;
    }

    const aiPermissionCodes: ReadonlyArray<AiPermissionCode> = [
      AI_PERMISSION_CODES.USE,
      AI_PERMISSION_CODES.READ,
      AI_PERMISSION_CODES.WRITE_DRAFTS,
      AI_PERMISSION_CODES.APPROVE,
    ];
    const permissionIds = await this.permissionIdsByCode(aiPermissionCodes);

    await this.prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        roleId: superAdmin.id,
        permissionId,
      })),
      skipDuplicates: true,
    });
  }
}
