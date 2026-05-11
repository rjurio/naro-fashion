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
  @RequiresAiPermission(AI_PERMISSION_CODES.WRITE_DRAFTS)
  @Post(':id/execute')
  execute(@Param('id') id: string, @Body() dto: ExecuteApprovalAiDto) {
    return this.runner.run({
      tool: 'execute_approval',
      actionType: 'PUBLISH',
      // approvalToken is preserved by the sanitiser's allowlist for
      // forensic traceability. It's already been consumed by the time
      // this audit row is written.
      input: { id, approvalToken: dto.approvalToken },
      targetResourceType: 'AgentApprovalRequest',
      targetResourceId: id,
      handler: () => this.approvals.execute(id, dto.approvalToken),
      message: (data: any) =>
        `Executed approval ${id} — produced ${data?.approvalRequest?.tool} write on ${data?.approvalRequest?.targetResourceType}.`,
    });
  }
}
