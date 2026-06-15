import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_AGENT_ROLE_NAMES,
  AI_PERMISSION_CODES,
} from '../types/ai-permissions.types';

/**
 * Phase 3.2 — SUPER_ADMIN demotion (Decision Log #2).
 *
 * Removes `ai-agent:approve` from every `SUPER_ADMIN` role at application
 * bootstrap. After this runs, AI approval power must be intentionally
 * granted via the `AI_AGENT_APPROVER` system role — assigned by an admin
 * through `/dashboard/ai/role-assignments`.
 *
 * Why a boot-time service (not a one-off CLI script):
 *   - Matches the existing AI seeder pattern (`AiRolesSeederService` also
 *     runs at `OnApplicationBootstrap`).
 *   - Self-healing: if a future migration ever re-grants `:approve` to
 *     SUPER_ADMIN (e.g. someone runs the 3.0 backfill on a stale DB), the
 *     next boot quietly undoes it.
 *   - No manual ssh-and-run step on the VPS; no operator-error window.
 *
 * Why idempotent rather than one-shot:
 *   - `deleteMany` on the `(roleId, permissionId)` join rows is a no-op
 *     when the rows are already gone. No bookkeeping flag needed.
 *   - The state of `RolePermission` is itself the durable record of
 *     completion — post-demotion, the rows aren't there.
 *
 * Why no `AdminActivityLog` / `AgentAuditLog` row:
 *   - Both tables require a non-null `adminUserId`. There is no admin
 *     user behind a boot-time platform migration. Synthesising one (e.g.
 *     "first PlatformAdmin") would muddy the audit trail.
 *   - Structured Logger output via PM2/journald is the audit. Git history
 *     records the change-author. The DB state records the outcome.
 *
 * Safety:
 *   - Env override `AI_PHASE_3_2_DEMOTION_ENABLED=false` skips the entire
 *     service. Use only for break-glass rollback scenarios.
 *   - `AI_AGENT_APPROVER` and `AI_AGENT_OPERATOR` roles are NEVER touched;
 *     the where-clause restricts deletion to `SUPER_ADMIN` only.
 *   - Other SUPER_ADMIN AI permissions (`:use`, `:read`, `:write-drafts`)
 *     are preserved. SUPER_ADMINs can still initiate AI write actions —
 *     they just can't approve their own.
 *
 * Pre-flight warning (not a block):
 *   - If no admin holds `AI_AGENT_APPROVER`, the service logs WARN with
 *     a "no approver assigned" message and still proceeds with the
 *     demotion. Per Decision Log #2: "A tenant with no AI_AGENT_APPROVER
 *     assigned cannot run risky AI writes — initiation works, but no one
 *     can approve. The friction is intentional."
 */
@Injectable()
export class AiSuperAdminDemotionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiSuperAdminDemotionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.AI_PHASE_3_2_DEMOTION_ENABLED === 'false') {
      this.logger.warn(
        'AI Phase 3.2 demotion is DISABLED via AI_PHASE_3_2_DEMOTION_ENABLED=false. ' +
          'SUPER_ADMIN retains ai-agent:approve. This is a break-glass override; remove the env var to re-enable.',
      );
      return;
    }

    try {
      await this.runDemotion();
    } catch (err: any) {
      // Boot must never fail because of this service. Next boot will retry.
      this.logger.error(
        `AI Phase 3.2 demotion failed (will retry on next boot): ${err?.message ?? err}`,
      );
    }
  }

  private async runDemotion(): Promise<void> {
    // 1. Resolve the :approve permission row. If it doesn't exist, Phase 3.0
    //    hasn't seeded yet on this DB — nothing to demote. Quietly return.
    const approvePerm = await this.prisma.permission.findUnique({
      where: { code: AI_PERMISSION_CODES.APPROVE },
      select: { id: true },
    });
    if (!approvePerm) {
      return;
    }

    // 2. Find every SUPER_ADMIN role. We match by name + isSystem ONLY
    //    (no tenantId filter) so we hit both the platform-level row and
    //    any tenant-scoped duplicates (see commit 72692e2 — these exist
    //    in the wild on prod from earlier seeding paths).
    const superAdminRoles = await this.prisma.role.findMany({
      where: { name: 'SUPER_ADMIN', isSystem: true },
      select: { id: true, tenantId: true },
    });
    if (superAdminRoles.length === 0) {
      // Fresh install where RolesService hasn't run yet. Bootstrap order
      // surprised us; the next boot will fix it.
      return;
    }

    // 3. Pre-flight: count tenants with at least one admin holding
    //    AI_AGENT_APPROVER. If zero, log a WARN but DON'T block —
    //    Decision Log #2 says the friction is intentional.
    const approverCount = await this.countAdminsWithApproverRole();
    if (approverCount === 0) {
      this.logger.warn(
        'Phase 3.2 pre-flight: NO admin currently holds AI_AGENT_APPROVER. ' +
          'After demotion, risky AI writes cannot be approved by anyone. ' +
          'Assign AI_AGENT_APPROVER via /dashboard/ai/role-assignments. ' +
          'Proceeding with demotion anyway — see Decision Log #2 (intentional friction).',
      );
    }

    // 4. Idempotent demotion. deleteMany on the (role, permission) join
    //    rows. Returns count = 0 on subsequent boots once the rows are
    //    gone, so this is a no-op after the first successful run.
    const result = await this.prisma.rolePermission.deleteMany({
      where: {
        permissionId: approvePerm.id,
        roleId: { in: superAdminRoles.map((r) => r.id) },
      },
    });

    if (result.count > 0) {
      this.logger.log(
        `Phase 3.2 demotion COMPLETED: revoked ai-agent:approve from ${result.count} SUPER_ADMIN role-permission row(s) ` +
          `across ${superAdminRoles.length} SUPER_ADMIN role(s). ` +
          `AI approval power now requires explicit AI_AGENT_APPROVER assignment. ` +
          `Approvers currently assigned: ${approverCount}.`,
      );
    } else {
      // First boot after demotion already ran — this is the steady state.
      // Log at debug level to avoid noise on every boot.
      this.logger.debug?.(
        'Phase 3.2 demotion: already complete (no SUPER_ADMIN holds ai-agent:approve).',
      );
    }
  }

  /**
   * Count distinct AdminUsers who hold the AI_AGENT_APPROVER role
   * (system role, name match, isSystem=true). Used only for the
   * pre-flight WARN; does NOT gate the demotion.
   */
  private async countAdminsWithApproverRole(): Promise<number> {
    const approverRoles = await this.prisma.role.findMany({
      where: {
        name: AI_AGENT_ROLE_NAMES.APPROVER,
        isSystem: true,
      },
      select: { id: true },
    });
    if (approverRoles.length === 0) return 0;

    const distinctAdmins = await this.prisma.adminUserRole.findMany({
      where: { roleId: { in: approverRoles.map((r) => r.id) } },
      select: { adminUserId: true },
      distinct: ['adminUserId'],
    });
    return distinctAdmins.length;
  }
}
