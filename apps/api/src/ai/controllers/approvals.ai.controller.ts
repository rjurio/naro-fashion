import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AiSecured } from '../common/ai-controller.decorators';
import {
  AI_PERMISSION_CODES,
  RequiresAiPermission,
} from '../decorators/requires-ai-permission.decorator';
import { ApprovalService } from '../services/approval.service';
import { AiToolRunner } from '../services/ai-tool-runner.service';
import {
  ExecuteApprovalAiDto,
  RejectApprovalAiDto,
  RevokeApprovalAiDto,
} from '../dto/approval-action.ai.dto';
import { hashApprovalToken } from '../util/approval-token';

/**
 * Approvals management surface — Phase 3.1A.
 *
 * Lives under `/api/v1/ai/approvals/*` and houses the lifecycle endpoints
 * (approve, reject, revoke, cancel, execute, list, get) for every
 * @RequiresApproval-decorated tool. Phase 3.1A wires only ONE tool —
 * `publish_product` — but the controller is tool-agnostic; new risky
 * tools plug in via `ApprovalService` without touching this file.
 *
 * Permissions (per route):
 *   - approve / reject / revoke → ai-agent:approve  (+ four-eyes runtime check)
 *   - cancel / execute          → ai-agent:write-drafts  (+ initiator runtime check)
 *   - list / get                → ai-agent:read
 */
@AiSecured()
@Controller('ai/approvals')
export class ApprovalsAiController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly runner: AiToolRunner,
  ) {}

  // GET /api/v1/ai/approvals?status=PENDING
  @RequiresAiPermission(AI_PERMISSION_CODES.READ)
  @Get()
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.runner.run({
      tool: 'list_approvals',
      actionType: 'READ',
      input: { status, limit },
      targetResourceType: 'AgentApprovalRequest',
      handler: () =>
        this.approvals.list({
          status,
          limit: limit ? Number(limit) : undefined,
        }),
      message: (data: any) =>
        `Returned ${Array.isArray(data) ? data.length : 0} approval request(s)`,
    });
  }

  // GET /api/v1/ai/approvals/:id
  @RequiresAiPermission(AI_PERMISSION_CODES.READ)
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.runner.run({
      tool: 'get_approval',
      actionType: 'READ',
      input: { id },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.getOne(id),
    });
  }

  // POST /api/v1/ai/approvals/:id/approve
  //
  // The handler returns the raw token in the response body. We MUST NOT
  // let the runner audit it as-is (its default behaviour is to persist
  // the handler's full return value as outputJson). Decision Log #6 —
  // the raw token never persists to AgentAuditLog. The `auditOutput`
  // transform strips it before the audit write while leaving the
  // response to the client untouched.
  @RequiresAiPermission(AI_PERMISSION_CODES.APPROVE)
  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.runner.run({
      tool: 'approve_request',
      actionType: 'APPROVAL_GRANTED',
      input: { id },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.approve(id),
      auditOutput: (summary) => {
        const { approvalToken, ...redacted } = summary as any;
        // approvalToken is intentionally dropped; tokenIssued + status
        // still tell forensics that a token was minted at this time.
        void approvalToken; // referenced to keep linters quiet
        return redacted;
      },
      message: () => 'Approval granted. Raw token returned ONCE — store it now.',
    });
  }

  // POST /api/v1/ai/approvals/:id/reject
  @RequiresAiPermission(AI_PERMISSION_CODES.APPROVE)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectApprovalAiDto) {
    return this.runner.run({
      tool: 'reject_request',
      actionType: 'APPROVAL_REJECTED',
      input: { id, reason: dto.reason },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.reject(id, dto.reason),
      message: () => 'Approval rejected.',
    });
  }

  // POST /api/v1/ai/approvals/:id/revoke   (original approver only)
  @RequiresAiPermission(AI_PERMISSION_CODES.APPROVE)
  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Body() dto: RevokeApprovalAiDto) {
    return this.runner.run({
      tool: 'revoke_approval',
      actionType: 'APPROVAL_REVOKED',
      input: { id, reason: dto?.reason },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.revoke(id, dto?.reason),
      message: () => 'Approval revoked. Token invalidated.',
    });
  }

  // POST /api/v1/ai/approvals/:id/cancel   (initiator only)
  @RequiresAiPermission(AI_PERMISSION_CODES.WRITE_DRAFTS)
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.runner.run({
      tool: 'cancel_approval',
      actionType: 'APPROVAL_CANCELLED',
      input: { id },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.cancel(id),
      message: () => 'Approval cancelled by initiator.',
    });
  }

  // POST /api/v1/ai/approvals/:id/execute   (initiator only)
  //
  // The raw `approvalToken` from the request body is consumed inside
  // ApprovalService.execute() — it MUST NEVER end up in the audit
  // input/output JSON. We log a boolean `tokenProvided` instead so a
  // forensic reader can tell that a token was offered without seeing
  // the token itself. After the call succeeds, the linked
  // AgentApprovalRequest row (and its `status` + cleared
  // `approvalTokenHash`) is the canonical "what happened" trail.
  //
  // Combined with the sanitiser's `approvaltoken` redact pattern (Phase
  // 3.1A hardening 2026-05-11) this is belt-and-braces: even if a
  // future caller accidentally passes the raw token through the runner
  // input, the sanitiser will strip it.
  @RequiresAiPermission(AI_PERMISSION_CODES.WRITE_DRAFTS)
  @Post(':id/execute')
  execute(@Param('id') id: string, @Body() dto: ExecuteApprovalAiDto) {
    // Forensic correlation breadcrumb (Phase 3.1A re-hardening 2026-05-11):
    // Compute the SHA-256 of the incoming raw token, then keep only the
    // first 6 hex chars. This lets a future investigator correlate "this
    // execute attempt used the token whose hash starts with abc123…"
    // against the AgentApprovalRequest row (which stored the FULL hash
    // before consume cleared it). 6 hex chars = 24 bits of the hash — no
    // realistic preimage threat (the underlying token is also already
    // single-use + consumed by the time anyone reads this row), but
    // enough to disambiguate concurrent execute attempts in audit
    // forensics. The raw token NEVER leaves this expression.
    const tokenHashPrefix =
      typeof dto.approvalToken === 'string' && dto.approvalToken.length > 0
        ? hashApprovalToken(dto.approvalToken).slice(0, 6)
        : undefined;

    return this.runner.run({
      tool: 'execute_approval',
      actionType: 'PUBLISH',
      input: {
        id,
        tokenProvided: !!dto.approvalToken,
        // First 6 hex of sha256(rawToken). Not the raw token. Not the
        // full hash (which is also wiped from the DB after consume).
        // Inert breadcrumb for forensic correlation only.
        ...(tokenHashPrefix ? { tokenHashPrefix } : {}),
      },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.execute(id, dto.approvalToken),
      auditOutput: (data: any) => ({
        // Defence-in-depth — only the resource-level outcome is logged;
        // never the approval summary in case it ever grew a token field.
        approvalRequestId: data?.approvalRequest?.id,
        approvalRequestStatus: data?.approvalRequest?.status,
        result: data?.data,
        tokenValid: true,
      }),
      message: (data: any) =>
        `Executed approval ${id} — produced ${data?.approvalRequest?.tool} write on ${data?.approvalRequest?.targetResourceType}.`,
    });
  }
}
