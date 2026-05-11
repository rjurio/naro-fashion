import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AiSanitizerService } from './ai-sanitizer.service';
import { AGENT_APPROVAL_STATUS } from '../types/agent-approval.types';

/**
 * Approval expiry cron — Phase 3.1.
 *
 * Runs every 60 seconds. Flips any PENDING/APPROVED row whose `expiresAt`
 * has passed to status=EXPIRED with expirationReason='ttl', and writes
 * one AgentAuditLog row per affected request so the activity dashboard
 * sees the transition.
 *
 * Lazy-expiry checks ALSO run in the request paths (approve/execute), so
 * the cron is purely a cleanup mechanism — it's not the only line of
 * defence. That means the 60-second cadence is fine; up to ~60s of
 * "expired but still PENDING" between cron ticks is acceptable.
 *
 * NOT request-scoped — runs without a request user, so the audit rows
 * use `adminUserIdOverride: null`-equivalent (system row).
 */
@Injectable()
export class ApprovalExpiryCron {
  private readonly logger = new Logger(ApprovalExpiryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sanitizer: AiSanitizerService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      // One row at a time so we can write a per-row audit log. Most
      // tenants will have <50 open approvals at any given time — this is
      // cheap and the per-row audit is the price of clean linkage.
      const expired = await this.prisma.agentApprovalRequest.findMany({
        where: {
          status: {
            in: [AGENT_APPROVAL_STATUS.PENDING, AGENT_APPROVAL_STATUS.APPROVED],
          },
          expiresAt: { lt: new Date() },
        },
        select: {
          id: true,
          tenantId: true,
          toolName: true,
          requestedByAdminUserId: true,
          targetResourceType: true,
          targetResourceId: true,
        },
        take: 200,
      });

      for (const row of expired) {
        await this.prisma.agentApprovalRequest.updateMany({
          where: {
            id: row.id,
            status: {
              in: [
                AGENT_APPROVAL_STATUS.PENDING,
                AGENT_APPROVAL_STATUS.APPROVED,
              ],
            },
          },
          data: {
            status: AGENT_APPROVAL_STATUS.EXPIRED,
            expirationReason: 'ttl',
            // Defence-in-depth on APPROVED→EXPIRED: clear the token so a
            // leaked raw token can't consume after expiry.
            approvalTokenHash: null,
          },
        });

        // Write one audit row per expired request. We attribute it to the
        // request's initiator (the only person who definitely existed on
        // the system at request time) so the row has a non-null admin
        // user. Severity INFO — TTL expiry is normal lifecycle, not an
        // alarm.
        try {
          await this.prisma.agentAuditLog.create({
            data: {
              tenantId: row.tenantId,
              adminUserId: row.requestedByAdminUserId,
              agentName: 'naro-fashion-admin',
              toolName: row.toolName,
              actionType: 'APPROVAL_EXPIRED',
              targetResourceType: row.targetResourceType,
              targetResourceId: row.targetResourceId,
              inputJson: this.sanitizer.sanitize({
                approvalRequestId: row.id,
                reason: 'ttl',
              }) as any,
              approvalRequired: true,
              approvalStatus: AGENT_APPROVAL_STATUS.EXPIRED,
              approvalRequestId: row.id,
              status: 'FAILED',
              severity: 'INFO',
            },
          });
        } catch (auditErr) {
          // Audit failure must not stop us from expiring the row.
          this.logger.warn(
            `Audit insert failed for expired approval ${row.id}: ${(auditErr as any)?.message}`,
          );
        }
      }

      if (expired.length > 0) {
        this.logger.log(
          `Expired ${expired.length} approval request(s) on TTL sweep.`,
        );
      }
    } catch (err: any) {
      // Sweeper errors must not crash the scheduler. Next tick will retry.
      this.logger.warn(`Approval expiry sweep failed: ${err?.message ?? err}`);
    }
  }
}
