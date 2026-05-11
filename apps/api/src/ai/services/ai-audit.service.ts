import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant.context';
import { AiSanitizerService } from './ai-sanitizer.service';

export type AiActionType =
  | 'READ'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'RESTORE'
  | 'PUBLISH'
  | 'ARCHIVE'
  | 'STATUS_CHANGE'
  | 'ADJUST_INVENTORY'
  | 'NOTE'
  // Approval workflow lifecycle (Phase 3.1+).
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_REVOKED'
  | 'APPROVAL_CANCELLED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_EXHAUSTED'
  | 'SELF_APPROVAL_BLOCKED';

export type AiAuditStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'MODULE_DISABLED';

export type AiAuditSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export interface AiAuditRecordArgs {
  tool: string;
  actionType: AiActionType;
  input?: unknown;
  output?: unknown;
  targetResourceType?: string;
  targetResourceId?: string;
  status: AiAuditStatus;
  errorMessage?: string;
  severity?: AiAuditSeverity;
  approvalRequired?: boolean;
  approvalStatus?: string;
  approvalRequestId?: string;
  durationMs?: number;
  /**
   * Phase 3.1+ — override the adminUserId on the audit row. Used by the
   * cron expiry job which has no request user but still needs to write
   * audit rows. When unset the service reads from `request.user` (Phase
   * 1/2 default behaviour).
   */
  adminUserIdOverride?: string;
  tenantIdOverride?: string | null;
}

/**
 * Writes one row to AgentAuditLog per AI tool invocation. Phase 1 ships
 * READ-only audit; write-action paths are added in later phases. This
 * service is intentionally request-scoped so it can read the current
 * adminUserId, IP, and user-agent from the express request without the
 * caller having to plumb them through.
 *
 * The service swallows its own errors — a broken audit must never break
 * a successful tool call. The handler still gets a stable string back
 * (an empty string when persistence fails) so the envelope shape is
 * preserved.
 */
@Injectable({ scope: Scope.REQUEST })
export class AiAuditService {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly sanitizer: AiSanitizerService,
  ) {}

  async record(args: AiAuditRecordArgs): Promise<string> {
    try {
      const req = this.request as any;
      const adminUserId: string | undefined =
        args.adminUserIdOverride ?? req?.user?.id;

      // No identifiable admin user — refuse to record. This should never
      // happen in production because every AI route is behind AdminGuard,
      // but it does happen in unit tests where the request is mocked.
      if (!adminUserId) return '';

      // Best-effort tenant scope. AI tool routes always run inside an
      // authenticated session so this should usually resolve. The cron
      // expiry job passes its own tenantId since it has no request scope.
      const tenantId =
        args.tenantIdOverride !== undefined
          ? args.tenantIdOverride
          : this.safeTenantId();

      const sessionId = this.extractSessionId(req);
      const ipAddress = this.extractIp(req);
      const userAgent = req?.headers?.['user-agent'] ?? null;

      const inputJson =
        args.input === undefined ? null : (this.sanitizer.sanitize(args.input) as any);
      const outputJson =
        args.output === undefined ? null : (this.sanitizer.sanitize(args.output) as any);

      const row = await this.prisma.agentAuditLog.create({
        data: {
          tenantId,
          adminUserId,
          agentName: 'naro-fashion-admin',
          sessionId,
          toolName: args.tool,
          actionType: args.actionType,
          targetResourceType: args.targetResourceType,
          targetResourceId: args.targetResourceId,
          inputJson,
          outputJson,
          approvalRequired: args.approvalRequired ?? false,
          approvalStatus: args.approvalStatus ?? 'NOT_REQUIRED',
          approvalRequestId: args.approvalRequestId,
          status: args.status,
          errorMessage: args.errorMessage,
          severity:
            args.severity ?? (args.status === 'SUCCESS' ? 'INFO' : 'WARNING'),
          ipAddress,
          userAgent,
          durationMs: args.durationMs,
        },
        select: { id: true },
      });
      return row.id;
    } catch {
      // Audit must never break the main flow.
      return '';
    }
  }

  private safeTenantId(): string | null {
    try {
      return this.tenantContext.id;
    } catch {
      return null;
    }
  }

  private extractSessionId(req: any): string | null {
    const raw = req.headers?.['x-agent-session-id'];
    if (typeof raw !== 'string') return null;
    // Cap at 64 chars — opaque to us, only used for grouping.
    return raw.slice(0, 64);
  }

  private extractIp(req: any): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0]!.trim().slice(0, 64);
    }
    return (req.ip ?? null) as string | null;
  }
}
