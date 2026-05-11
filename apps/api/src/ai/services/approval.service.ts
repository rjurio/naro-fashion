import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant.context';
import { AiAuditService } from './ai-audit.service';
import { PublishValidationService } from './publish-validation.service';
import { ArchiveValidationService } from './archive-validation.service';
import { payloadHash } from '../util/canonical-json';
import {
  generateApprovalToken,
  hashApprovalToken,
} from '../util/approval-token';
import {
  AGENT_APPROVAL_STATUS,
  AI_RISK_LEVEL,
  AI_RISK_LEVEL_TTL_MS,
  AiRiskLevel,
  MAX_APPROVAL_EXECUTION_ATTEMPTS,
} from '../types/agent-approval.types';

/**
 * Tool name constants — referenced by the runner, audit rows, and the
 * payload-hash binding. Adding a new approval-gated tool means adding a
 * new entry here AND a new `request*` method on this service AND a
 * `case` in `execute()`'s dispatch. Phase 3.1A shipped publish_product;
 * Phase 3.1B adds archive_product (and nothing else).
 */
export const APPROVAL_TOOL_NAMES = {
  PUBLISH_PRODUCT: 'publish_product',
  ARCHIVE_PRODUCT: 'archive_product',
} as const;

export type ApprovalToolName =
  (typeof APPROVAL_TOOL_NAMES)[keyof typeof APPROVAL_TOOL_NAMES];

/**
 * The shape returned by the request-approval endpoint. The operator-side
 * UX renders this directly — no token field, no hash, just the
 * snapshot + an expiry timestamp.
 */
export interface ApprovalRequestSummary {
  id: string;
  status: string;
  tool: string;
  actionTitle: string;
  businessSummary: string;
  riskLevel: AiRiskLevel;
  targetResourceType: string | null;
  targetResourceId: string | null;
  targetResourceName: string | null;
  beforeValues: unknown;
  afterValues: unknown;
  expiresAt: Date;
  ttlSeconds: number;
  createdAt: Date;
  /** Only populated for the approver after they hit /approve. Never persisted. */
  approvalToken?: string;
  /** True after approve, false otherwise. Public field. */
  tokenIssued: boolean;
  /** Hide stale stuff from list views. */
  executionAttempts: number;
}

/**
 * ApprovalService — Phase 3.1A.
 *
 * Owns the lifecycle of every AgentApprovalRequest row. The controllers
 * are thin wrappers that resolve the user + tenant and delegate to this
 * service. All four-eyes / TTL / payload-hash / stale-data / retry-cap
 * rules live in one place so they're easy to audit.
 *
 * Request-scoped because most methods need `req.user` for the
 * initiator / approver identity check.
 */
@Injectable({ scope: Scope.REQUEST })
export class ApprovalService {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AiAuditService,
    private readonly publishValidator: PublishValidationService,
    private readonly archiveValidator: ArchiveValidationService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //   request-approval — publish_product
  // ────────────────────────────────────────────────────────────────────

  /**
   * Build the AgentApprovalRequest for `publish_product`. Returns the
   * sanitised snapshot envelope the operator UI renders.
   */
  async requestPublishProduct(
    productId: string,
  ): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const initiatorId = this.requireAdminUserId();
    const tool = APPROVAL_TOOL_NAMES.PUBLISH_PRODUCT;
    const riskLevel = AI_RISK_LEVEL.HIGH;

    // Pre-flight validation — fails 400 before any row is written.
    const { product } = await this.publishValidator.validatePublishable(
      productId,
      tenantId,
    );

    const ttlMs = AI_RISK_LEVEL_TTL_MS[riskLevel];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const inputJson = { productId };
    const hash = payloadHash(tool, inputJson);

    const beforeValues = {
      isActive: false,
      slug: product!.slug,
      basePrice: product!.basePrice?.toString() ?? null,
    };
    const afterValues = {
      isActive: true,
      slug: product!.slug,
      basePrice: product!.basePrice?.toString() ?? null,
    };

    const created = await this.prisma.agentApprovalRequest.create({
      data: {
        tenantId,
        requestedByAdminUserId: initiatorId,
        toolName: tool,
        targetResourceType: 'Product',
        targetResourceId: product!.id,
        targetResourceName: product!.name,
        inputJson: inputJson as any,
        payloadHash: hash,
        actionTitle: `Publish '${product!.name}'`,
        businessSummary:
          `Make this product visible on the storefront. ` +
          `Price: TZS ${Number(product!.basePrice ?? 0).toLocaleString('en-US')}.`,
        riskLevel,
        beforeValues: beforeValues as any,
        afterValues: afterValues as any,
        expectedUpdatedAt: product!.updatedAt,
        status: AGENT_APPROVAL_STATUS.PENDING,
        expiresAt,
      },
    });

    await this.audit.record({
      tool,
      actionType: 'APPROVAL_REQUESTED',
      input: inputJson,
      targetResourceType: 'Product',
      targetResourceId: product!.id,
      approvalRequestId: created.id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.PENDING,
      severity: 'NOTICE',
      status: 'SUCCESS',
    });

    return this.toSummary(created);
  }

  // ────────────────────────────────────────────────────────────────────
  //   request-approval — archive_product (Phase 3.1B)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Build the AgentApprovalRequest for `archive_product`. Mirror of
   * `requestPublishProduct` with inverted before/after state. "Archive"
   * here means `isActive: false` — the product stays in admin but is
   * hidden from the storefront. NOT a soft-delete; `deletedAt` is left
   * alone (that's a separate operation, recycle-bin).
   */
  async requestArchiveProduct(
    productId: string,
  ): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const initiatorId = this.requireAdminUserId();
    const tool = APPROVAL_TOOL_NAMES.ARCHIVE_PRODUCT;
    const riskLevel = AI_RISK_LEVEL.HIGH;

    const { product } = await this.archiveValidator.validateArchivable(
      productId,
      tenantId,
    );

    const ttlMs = AI_RISK_LEVEL_TTL_MS[riskLevel];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const inputJson = { productId };
    const hash = payloadHash(tool, inputJson);

    const beforeValues = {
      isActive: true,
      slug: product.slug,
      name: product.name,
    };
    const afterValues = {
      isActive: false,
      slug: product.slug,
      name: product.name,
    };

    const created = await this.prisma.agentApprovalRequest.create({
      data: {
        tenantId,
        requestedByAdminUserId: initiatorId,
        toolName: tool,
        targetResourceType: 'Product',
        targetResourceId: product.id,
        targetResourceName: product.name,
        inputJson: inputJson as any,
        payloadHash: hash,
        actionTitle: `Archive '${product.name}'`,
        businessSummary:
          `Hide this product from the storefront. It will remain in admin ` +
          `for restore. Customers will get 404 on its slug. ` +
          `Current price: TZS ${Number(product.basePrice ?? 0).toLocaleString('en-US')}.`,
        riskLevel,
        beforeValues: beforeValues as any,
        afterValues: afterValues as any,
        expectedUpdatedAt: product.updatedAt,
        status: AGENT_APPROVAL_STATUS.PENDING,
        expiresAt,
      },
    });

    await this.audit.record({
      tool,
      actionType: 'APPROVAL_REQUESTED',
      input: inputJson,
      targetResourceType: 'Product',
      targetResourceId: product.id,
      approvalRequestId: created.id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.PENDING,
      severity: 'NOTICE',
      status: 'SUCCESS',
    });

    return this.toSummary(created);
  }

  // ────────────────────────────────────────────────────────────────────
  //   approve / reject / revoke / cancel
  // ────────────────────────────────────────────────────────────────────

  async approve(id: string): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const approverId = this.requireAdminUserId();

    const row = await this.requireRow(id, tenantId);

    // Four-eyes (Layer 1 runtime check).
    if (row.requestedByAdminUserId === approverId) {
      await this.audit.record({
        tool: row.toolName,
        actionType: 'SELF_APPROVAL_BLOCKED',
        input: { approvalRequestId: id },
        targetResourceType: row.targetResourceType ?? undefined,
        targetResourceId: row.targetResourceId ?? undefined,
        approvalRequestId: id,
        approvalRequired: true,
        approvalStatus: row.status,
        severity: 'WARNING',
        status: 'PERMISSION_DENIED',
        errorMessage: 'Self-approval blocked by four-eyes rule',
      });
      throw new ForbiddenException({
        code: 'forbidden_self_approval',
        message: 'You cannot approve your own request (four-eyes rule).',
      });
    }

    if (row.status !== AGENT_APPROVAL_STATUS.PENDING) {
      throw new ConflictException({
        code: 'invalid_state',
        message: `Approval is in state ${row.status}; only PENDING requests can be approved.`,
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      // Lazy-expire on read.
      await this.prisma.agentApprovalRequest.update({
        where: { id: row.id },
        data: {
          status: AGENT_APPROVAL_STATUS.EXPIRED,
          expirationReason: 'ttl',
        },
      });
      throw this.gone('approval_expired', 'Approval expired (TTL exceeded).');
    }

    const { rawToken, tokenHash } = generateApprovalToken();

    // Atomic conditional update — only succeeds while still PENDING and
    // before expiry; a racing approver/reject/cancel/cron loses.
    const updated = await this.prisma.agentApprovalRequest.updateMany({
      where: {
        id: row.id,
        tenantId,
        status: AGENT_APPROVAL_STATUS.PENDING,
        approvalTokenHash: null,
      },
      data: {
        status: AGENT_APPROVAL_STATUS.APPROVED,
        approvedAt: new Date(),
        approvedByAdminUserId: approverId,
        approvalTokenHash: tokenHash,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Approval state changed concurrently; re-fetch and retry.',
      });
    }

    const after = await this.prisma.agentApprovalRequest.findUnique({
      where: { id: row.id },
    });

    await this.audit.record({
      tool: row.toolName,
      actionType: 'APPROVAL_GRANTED',
      input: { approvalRequestId: id },
      targetResourceType: row.targetResourceType ?? undefined,
      targetResourceId: row.targetResourceId ?? undefined,
      approvalRequestId: id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.APPROVED,
      severity: 'NOTICE',
      status: 'SUCCESS',
    });

    const summary = this.toSummary(after!);
    // Return the raw token EXACTLY ONCE — never stored anywhere else.
    summary.approvalToken = rawToken;
    summary.tokenIssued = true;
    return summary;
  }

  async reject(
    id: string,
    reason: string,
  ): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const approverId = this.requireAdminUserId();
    const row = await this.requireRow(id, tenantId);

    if (row.requestedByAdminUserId === approverId) {
      await this.audit.record({
        tool: row.toolName,
        actionType: 'SELF_APPROVAL_BLOCKED',
        input: { approvalRequestId: id, mode: 'reject' },
        targetResourceType: row.targetResourceType ?? undefined,
        targetResourceId: row.targetResourceId ?? undefined,
        approvalRequestId: id,
        approvalRequired: true,
        approvalStatus: row.status,
        severity: 'WARNING',
        status: 'PERMISSION_DENIED',
        errorMessage: 'Self-rejection blocked by four-eyes rule',
      });
      throw new ForbiddenException({
        code: 'forbidden_self_approval',
        message: 'You cannot reject your own request (four-eyes rule).',
      });
    }

    if (row.status !== AGENT_APPROVAL_STATUS.PENDING) {
      throw new ConflictException({
        code: 'invalid_state',
        message: `Approval is in state ${row.status}; only PENDING requests can be rejected.`,
      });
    }

    const updated = await this.prisma.agentApprovalRequest.updateMany({
      where: { id: row.id, tenantId, status: AGENT_APPROVAL_STATUS.PENDING },
      data: {
        status: AGENT_APPROVAL_STATUS.REJECTED,
        rejectedAt: new Date(),
        approvedByAdminUserId: approverId,
        rejectionReason: reason?.slice(0, 500) ?? null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Approval state changed concurrently; re-fetch and retry.',
      });
    }

    await this.audit.record({
      tool: row.toolName,
      actionType: 'APPROVAL_REJECTED',
      input: { approvalRequestId: id, reason: reason?.slice(0, 500) },
      targetResourceType: row.targetResourceType ?? undefined,
      targetResourceId: row.targetResourceId ?? undefined,
      approvalRequestId: id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.REJECTED,
      severity: 'NOTICE',
      status: 'SUCCESS',
    });

    const after = await this.prisma.agentApprovalRequest.findUnique({
      where: { id: row.id },
    });
    return this.toSummary(after!);
  }

  async revoke(
    id: string,
    reason?: string,
  ): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const approverId = this.requireAdminUserId();
    const row = await this.requireRow(id, tenantId);

    if (row.status !== AGENT_APPROVAL_STATUS.APPROVED) {
      throw new ConflictException({
        code: 'invalid_state',
        message: `Approval is in state ${row.status}; only APPROVED requests can be revoked.`,
      });
    }
    if (row.approvedByAdminUserId !== approverId) {
      throw new ForbiddenException({
        code: 'forbidden_not_original_approver',
        message: 'Only the original approver can revoke this approval.',
      });
    }

    const updated = await this.prisma.agentApprovalRequest.updateMany({
      where: { id: row.id, tenantId, status: AGENT_APPROVAL_STATUS.APPROVED },
      data: {
        status: AGENT_APPROVAL_STATUS.REVOKED,
        revokedAt: new Date(),
        rejectionReason: reason?.slice(0, 500) ?? 'revoked by approver',
        // Defence-in-depth — clear the hash so a leaked token can't consume.
        approvalTokenHash: null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Approval state changed concurrently; re-fetch and retry.',
      });
    }

    await this.audit.record({
      tool: row.toolName,
      actionType: 'APPROVAL_REVOKED',
      input: { approvalRequestId: id, reason: reason?.slice(0, 500) },
      targetResourceType: row.targetResourceType ?? undefined,
      targetResourceId: row.targetResourceId ?? undefined,
      approvalRequestId: id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.REVOKED,
      severity: 'NOTICE',
      status: 'SUCCESS',
    });

    const after = await this.prisma.agentApprovalRequest.findUnique({
      where: { id: row.id },
    });
    return this.toSummary(after!);
  }

  async cancel(id: string): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const initiatorId = this.requireAdminUserId();
    const row = await this.requireRow(id, tenantId);

    if (row.requestedByAdminUserId !== initiatorId) {
      throw new ForbiddenException({
        code: 'forbidden_not_initiator',
        message: 'Only the original initiator can cancel this request.',
      });
    }
    if (row.status !== AGENT_APPROVAL_STATUS.PENDING) {
      throw new ConflictException({
        code: 'invalid_state',
        message: `Approval is in state ${row.status}; only PENDING requests can be cancelled.`,
      });
    }

    const updated = await this.prisma.agentApprovalRequest.updateMany({
      where: { id: row.id, tenantId, status: AGENT_APPROVAL_STATUS.PENDING },
      data: {
        status: AGENT_APPROVAL_STATUS.CANCELLED,
        cancelledAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'invalid_state',
        message: 'Approval state changed concurrently; re-fetch and retry.',
      });
    }

    await this.audit.record({
      tool: row.toolName,
      actionType: 'APPROVAL_CANCELLED',
      input: { approvalRequestId: id },
      targetResourceType: row.targetResourceType ?? undefined,
      targetResourceId: row.targetResourceId ?? undefined,
      approvalRequestId: id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.CANCELLED,
      severity: 'INFO',
      status: 'SUCCESS',
    });

    const after = await this.prisma.agentApprovalRequest.findUnique({
      where: { id: row.id },
    });
    return this.toSummary(after!);
  }

  // ────────────────────────────────────────────────────────────────────
  //   list / get
  // ────────────────────────────────────────────────────────────────────

  async list(opts: { status?: string; limit?: number } = {}) {
    const tenantId = this.tenantContext.requireId;
    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    const rows = await this.prisma.agentApprovalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
    return rows.map((r) => this.toSummary(r));
  }

  async getOne(id: string): Promise<ApprovalRequestSummary> {
    const tenantId = this.tenantContext.requireId;
    const row = await this.requireRow(id, tenantId);
    return this.toSummary(row);
  }

  // ────────────────────────────────────────────────────────────────────
  //   execute (consume token + run write)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Consume an approval token and execute its underlying action.
   *
   * The Prisma compare-and-swap pattern (`updateMany` with a `status`
   * filter in the WHERE) serialises concurrent consume attempts at the
   * DB level — only one transaction wins. We DON'T need raw `SELECT FOR
   * UPDATE` because we never branch on the row's content within the
   * transaction; every state change is encoded into the conditional
   * update's WHERE clause.
   *
   * Failure semantics (PHASE_3_DESIGN.md §5 + Decision Log #1, #13):
   *   - Pre-flight bump of `executionAttempts` in its own transaction,
   *     so the cap survives even if the consume transaction crashes.
   *   - After 3 failed attempts → status=EXHAUSTED, hash cleared, 410.
   *   - On stale-data / payload-mismatch → status=EXPIRED, hash cleared,
   *     409 (operator must re-initiate).
   *   - On transient handler failure → consume transaction rolls back;
   *     status stays APPROVED; operator may retry within TTL until 3 used.
   */
  async execute(
    approvalId: string,
    rawToken: string,
  ): Promise<{ approvalRequest: ApprovalRequestSummary; data: any }> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new BadRequestException(
        'approvalToken is required in the request body.',
      );
    }
    const tokenHash = hashApprovalToken(rawToken);
    const tenantId = this.tenantContext.requireId;
    const initiatorId = this.requireAdminUserId();

    // Initial read — we need the row to validate state before any side
    // effects. Tenant-scoped + token-hash-scoped lookup.
    const row = await this.prisma.agentApprovalRequest.findFirst({
      where: { id: approvalId, tenantId, approvalTokenHash: tokenHash },
    });
    if (!row) {
      throw this.gone(
        'approval_invalid_or_consumed',
        'No matching approval — token may be wrong, revoked, consumed, or for a different tenant.',
      );
    }
    if (row.status !== AGENT_APPROVAL_STATUS.APPROVED) {
      throw this.gone(
        'approval_invalid_or_consumed',
        `Approval is in state ${row.status}; cannot execute.`,
      );
    }
    if (row.requestedByAdminUserId !== initiatorId) {
      throw new ForbiddenException({
        code: 'forbidden_not_initiator',
        message: 'Only the original initiator can execute this approval.',
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.agentApprovalRequest.updateMany({
        where: { id: row.id, tenantId, status: AGENT_APPROVAL_STATUS.APPROVED },
        data: {
          status: AGENT_APPROVAL_STATUS.EXPIRED,
          expirationReason: 'ttl',
          approvalTokenHash: null,
        },
      });
      throw this.gone('approval_expired', 'Approval expired (TTL exceeded).');
    }

    // Pre-flight attempt-counter bump in its own transaction so the cap
    // is enforced even if the main transaction crashes mid-write.
    const bump = await this.prisma.agentApprovalRequest.updateMany({
      where: {
        id: row.id,
        tenantId,
        status: AGENT_APPROVAL_STATUS.APPROVED,
        approvalTokenHash: tokenHash,
        executionAttempts: { lt: MAX_APPROVAL_EXECUTION_ATTEMPTS },
      },
      data: { executionAttempts: { increment: 1 } },
    });
    if (bump.count !== 1) {
      // Either someone else won the race OR the cap is exhausted.
      const fresh = await this.prisma.agentApprovalRequest.findFirst({
        where: { id: row.id, tenantId },
      });
      if (
        fresh &&
        fresh.executionAttempts >= MAX_APPROVAL_EXECUTION_ATTEMPTS &&
        fresh.status !== AGENT_APPROVAL_STATUS.CONSUMED
      ) {
        await this.prisma.agentApprovalRequest.updateMany({
          where: { id: row.id, tenantId },
          data: {
            status: AGENT_APPROVAL_STATUS.EXHAUSTED,
            approvalTokenHash: null,
          },
        });
        await this.audit.record({
          tool: row.toolName,
          actionType: 'APPROVAL_EXHAUSTED',
          input: { approvalRequestId: row.id },
          targetResourceType: row.targetResourceType ?? undefined,
          targetResourceId: row.targetResourceId ?? undefined,
          approvalRequestId: row.id,
          approvalRequired: true,
          approvalStatus: AGENT_APPROVAL_STATUS.EXHAUSTED,
          severity: 'WARNING',
          status: 'FAILED',
          errorMessage: '3 execution attempts exhausted',
        });
        throw this.gone(
          'approval_exhausted',
          'This approval has used all 3 execution attempts. Re-initiate from scratch.',
        );
      }
      throw this.gone(
        'approval_invalid_or_consumed',
        'Approval state changed concurrently — refetch and retry.',
      );
    }

    // Stale-data check + payload-hash check happen BEFORE we touch the
    // resource. If either fails we invalidate the approval and tell the
    // operator to re-initiate.
    const product = await this.prisma.product.findFirst({
      where: { id: row.targetResourceId!, tenantId },
    });
    if (!product) {
      // Target vanished — invalidate.
      await this.prisma.agentApprovalRequest.updateMany({
        where: { id: row.id, tenantId },
        data: {
          status: AGENT_APPROVAL_STATUS.EXPIRED,
          expirationReason: 'stale_data',
          approvalTokenHash: null,
        },
      });
      throw new ConflictException({
        code: 'stale_data',
        message:
          'Target product no longer exists. Re-initiate the approval against the new state.',
      });
    }
    if (
      row.expectedUpdatedAt &&
      product.updatedAt.getTime() !== row.expectedUpdatedAt.getTime()
    ) {
      await this.prisma.agentApprovalRequest.updateMany({
        where: { id: row.id, tenantId },
        data: {
          status: AGENT_APPROVAL_STATUS.EXPIRED,
          expirationReason: 'stale_data',
          approvalTokenHash: null,
        },
      });
      throw new ConflictException({
        code: 'stale_data',
        message:
          'Product changed since approval was requested. Re-initiate the approval against the new state.',
        currentUpdatedAt: product.updatedAt,
      });
    }

    const computedHash = payloadHash(row.toolName, row.inputJson);
    if (computedHash !== row.payloadHash) {
      // This catches DB-tampering / future schema drift; the inputJson is
      // never re-derived from a wire request in this Phase 3.1A flow.
      await this.prisma.agentApprovalRequest.updateMany({
        where: { id: row.id, tenantId },
        data: {
          status: AGENT_APPROVAL_STATUS.EXPIRED,
          expirationReason: 'payload_mismatch',
          approvalTokenHash: null,
        },
      });
      throw new ConflictException({
        code: 'payload_mismatch',
        message:
          'Stored payload no longer matches its hash. Re-initiate the approval.',
      });
    }

    // Tool-specific final pre-flight validation — re-runs against the
    // current resource state so a product that became un-publishable or
    // un-archivable since request time is rejected here. Each tool has
    // its own validator + its own "what change to write" semantics.
    let nextActiveState: boolean;
    switch (row.toolName) {
      case APPROVAL_TOOL_NAMES.PUBLISH_PRODUCT:
        await this.publishValidator.validatePublishable(
          row.targetResourceId!,
          tenantId,
        );
        nextActiveState = true;
        break;
      case APPROVAL_TOOL_NAMES.ARCHIVE_PRODUCT:
        await this.archiveValidator.validateArchivable(
          row.targetResourceId!,
          tenantId,
        );
        nextActiveState = false;
        break;
      default:
        // Unknown tool stored on the row — defensive. Should never trip
        // because the controller surface only initiates known tools, but
        // if a future PR adds a tool here without updating the dispatch,
        // we want a precise error not a silent wrong-action.
        throw new BadRequestException(
          `Unsupported approval tool '${row.toolName}' for execute().`,
        );
    }

    // Main consume transaction: flip status + run the write atomically.
    let executionFailed = false;
    let executionError: any = null;
    let updatedProduct: any = null;
    try {
      updatedProduct = await this.prisma.$transaction(async (tx) => {
        const won = await tx.agentApprovalRequest.updateMany({
          where: {
            id: row.id,
            tenantId,
            status: AGENT_APPROVAL_STATUS.APPROVED,
            approvalTokenHash: tokenHash,
          },
          data: {
            status: AGENT_APPROVAL_STATUS.CONSUMED,
            consumedAt: new Date(),
            approvalTokenHash: null,
          },
        });
        if (won.count !== 1) {
          // Someone else consumed/revoked between the bump and the main
          // transaction. Throw so the outer catch rolls back the bump?
          // — no, the bump already committed. Just surface the conflict.
          throw new HttpException(
            {
              code: 'approval_invalid_or_consumed',
              message:
                'Approval state changed concurrently between checks and write.',
            },
            HttpStatus.GONE,
          );
        }

        // Phase 3.1B.α dispatch: every approval-gated product tool flips
        // `isActive` AND stamps/clears `archivedAt` so the lifecycle
        // state is unambiguous afterwards:
        //   publish_product  → isActive=true,  archivedAt=null  (lifts a draft to ACTIVE)
        //   archive_product  → isActive=false, archivedAt=now   (sends an ACTIVE row to ARCHIVED)
        // Clearing archivedAt on publish is defensive — publish_product's
        // validator already rejects archived products with a
        // "use restore_product" message, so this should be a no-op flip
        // from null to null in practice. Kept explicit so a future
        // restore_product tool can share the same write path.
        return tx.product.update({
          where: { id: row.targetResourceId! },
          data: {
            isActive: nextActiveState,
            archivedAt: nextActiveState ? null : new Date(),
          },
        });
      });
    } catch (err) {
      executionFailed = true;
      executionError = err;
    }

    if (executionFailed) {
      // The main transaction rolled back — status is back to APPROVED.
      // The pre-flight bump stays committed (one attempt is used).
      const fresh = await this.prisma.agentApprovalRequest.findFirst({
        where: { id: row.id, tenantId },
      });
      if (fresh && fresh.executionAttempts >= MAX_APPROVAL_EXECUTION_ATTEMPTS) {
        await this.prisma.agentApprovalRequest.updateMany({
          where: { id: row.id, tenantId },
          data: {
            status: AGENT_APPROVAL_STATUS.EXHAUSTED,
            approvalTokenHash: null,
          },
        });
        await this.audit.record({
          tool: row.toolName,
          actionType: 'APPROVAL_EXHAUSTED',
          input: { approvalRequestId: row.id },
          approvalRequestId: row.id,
          approvalRequired: true,
          approvalStatus: AGENT_APPROVAL_STATUS.EXHAUSTED,
          severity: 'WARNING',
          status: 'FAILED',
          errorMessage:
            executionError?.message ?? 'execution failed and cap reached',
        });
      }
      throw executionError;
    }

    // Success — write the final audit row linking the underlying op back
    // to the approval. Severity follows the risk level. actionType
    // tracks the tool so the activity dashboard can render the
    // operation-specific verb (PUBLISH vs ARCHIVE).
    const successActionType =
      row.toolName === APPROVAL_TOOL_NAMES.ARCHIVE_PRODUCT
        ? 'ARCHIVE'
        : 'PUBLISH';
    await this.audit.record({
      tool: row.toolName,
      actionType: successActionType,
      input: { approvalRequestId: row.id, productId: row.targetResourceId },
      output: {
        id: updatedProduct.id,
        slug: updatedProduct.slug,
        isActive: nextActiveState,
      },
      targetResourceType: 'Product',
      targetResourceId: updatedProduct.id,
      approvalRequestId: row.id,
      approvalRequired: true,
      approvalStatus: AGENT_APPROVAL_STATUS.CONSUMED,
      severity: row.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'NOTICE',
      status: 'SUCCESS',
    });

    const after = await this.prisma.agentApprovalRequest.findUnique({
      where: { id: row.id },
    });
    return {
      approvalRequest: this.toSummary(after!),
      data: {
        id: updatedProduct.id,
        slug: updatedProduct.slug,
        isActive: nextActiveState,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  //   helpers
  // ────────────────────────────────────────────────────────────────────

  /**
   * Lookup an approval row + assert it's in the caller's tenant. Returns
   * 404 (not 403) when out-of-tenant so the existence of cross-tenant
   * rows isn't leaked. Same pattern as the customer-ownership scoping.
   */
  private async requireRow(id: string, tenantId: string) {
    const row = await this.prisma.agentApprovalRequest.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Approval request not found');
    return row;
  }

  private requireAdminUserId(): string {
    const req = this.request as any;
    const id = req?.user?.id ?? req?.user?.sub;
    if (!id) {
      throw new ForbiddenException(
        'Approval workflow requires an authenticated admin user.',
      );
    }
    return id;
  }

  private gone(code: string, message: string): HttpException {
    return new HttpException({ code, message }, HttpStatus.GONE);
  }

  /**
   * Serialise a row for over-the-wire responses. **NEVER include the raw
   * token or the hash** — both are internal-only.
   */
  private toSummary(row: any): ApprovalRequestSummary {
    const ttlSeconds = Math.max(
      0,
      Math.floor((row.expiresAt.getTime() - Date.now()) / 1000),
    );
    return {
      id: row.id,
      status: row.status,
      tool: row.toolName,
      actionTitle: row.actionTitle,
      businessSummary: row.businessSummary,
      riskLevel: row.riskLevel,
      targetResourceType: row.targetResourceType,
      targetResourceId: row.targetResourceId,
      targetResourceName: row.targetResourceName,
      beforeValues: row.beforeValues ?? null,
      afterValues: row.afterValues ?? null,
      expiresAt: row.expiresAt,
      ttlSeconds,
      createdAt: row.createdAt,
      tokenIssued:
        row.status === AGENT_APPROVAL_STATUS.APPROVED &&
        !!row.approvalTokenHash,
      executionAttempts: row.executionAttempts ?? 0,
    };
  }
}
