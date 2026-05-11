import { Injectable, Scope } from '@nestjs/common';
import {
  AiAuditService,
  AiActionType,
  AiAuditStatus,
} from './ai-audit.service';
import { AiSuccessEnvelope, buildSuccessEnvelope } from '../util/ai-envelope';

export interface AiToolRunArgs<T> {
  /** Stable tool name, e.g. 'search_products'. Goes into the audit row + envelope. */
  tool: string;
  /** Defaults to 'READ' for Phase 1. */
  actionType?: AiActionType;
  /** Optional input snapshot — sanitised before it reaches the audit table. */
  input?: unknown;
  /** Resource type touched, e.g. 'Product'. */
  targetResourceType?: string;
  /** Specific resource id when known (eg. for `get_*` calls). */
  targetResourceId?: string;
  /** The actual work — usually a thin call into an existing service. */
  handler: () => Promise<T>;
  /** Optional human-readable summary for the agent UI. */
  message?: string | ((data: T) => string);
  /**
   * Override what gets written to `AgentAuditLog.outputJson` (instead of
   * the handler's full return value). Used by the approval controller's
   * `approve` route to strip the just-issued raw token from the audit
   * trail while still returning it to the caller in the response body.
   * Decision Log #6 — raw tokens MUST NEVER persist.
   */
  auditOutput?: (data: T) => unknown;
}

/**
 * AiToolRunner wraps a single AI tool call:
 *   1. Times the handler.
 *   2. On success, writes an audit row and returns a success envelope.
 *   3. On failure, writes an audit row, attaches AI metadata to the
 *      thrown error, and rethrows so AiExceptionFilter can produce the
 *      error envelope with the correct HTTP status.
 *
 * Request-scoped so it inherits AiAuditService's request scope. There is
 * exactly one runner instance per request — that's fine, runners are tiny.
 */
@Injectable({ scope: Scope.REQUEST })
export class AiToolRunner {
  constructor(private readonly audit: AiAuditService) {}

  async run<T>(args: AiToolRunArgs<T>): Promise<AiSuccessEnvelope<T>> {
    const start = Date.now();
    const actionType = args.actionType ?? 'READ';

    try {
      const data = await args.handler();
      const auditPayload = args.auditOutput ? args.auditOutput(data) : data;
      const auditId = await this.audit.record({
        tool: args.tool,
        actionType,
        input: args.input,
        output: auditPayload,
        targetResourceType: args.targetResourceType,
        targetResourceId: args.targetResourceId,
        status: 'SUCCESS',
        approvalRequired: false,
        approvalStatus: 'NOT_REQUIRED',
        durationMs: Date.now() - start,
      });

      const message =
        typeof args.message === 'function' ? args.message(data) : args.message;

      return buildSuccessEnvelope({
        tool: args.tool,
        data,
        auditId,
        message,
      });
    } catch (err: any) {
      const status = this.mapErrorStatus(err);
      const auditId = await this.audit.record({
        tool: args.tool,
        actionType,
        input: args.input,
        targetResourceType: args.targetResourceType,
        targetResourceId: args.targetResourceId,
        status,
        errorMessage: this.extractMessage(err),
        approvalRequired: false,
        approvalStatus: 'NOT_REQUIRED',
        severity: status === 'PERMISSION_DENIED' ? 'NOTICE' : 'WARNING',
        durationMs: Date.now() - start,
      });

      // Stamp the error so the exception filter can surface tool + auditId
      // in the error envelope.
      err.__aiTool = args.tool;
      err.__aiAuditId = auditId;
      throw err;
    }
  }

  private mapErrorStatus(err: any): AiAuditStatus {
    const httpStatus = err?.status ?? err?.response?.statusCode;
    if (httpStatus === 401) return 'UNAUTHORIZED';
    if (httpStatus === 403) return 'PERMISSION_DENIED';
    if (httpStatus === 400) return 'VALIDATION_ERROR';
    return 'FAILED';
  }

  private extractMessage(err: any): string {
    if (!err) return 'Unknown error';
    const r = err.response;
    if (r && typeof r === 'object') {
      const m = (r as any).message;
      if (Array.isArray(m)) return m.join('; ').slice(0, 1000);
      if (typeof m === 'string') return m.slice(0, 1000);
    }
    if (typeof err.message === 'string') return err.message.slice(0, 1000);
    return 'Unknown error';
  }
}
