import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApprovalService } from './approval.service';
import { PublishValidationService } from './publish-validation.service';
import { hashApprovalToken } from '../util/approval-token';
import { canonicalJSON, payloadHash } from '../util/canonical-json';
import {
  AGENT_APPROVAL_STATUS,
  AI_RISK_LEVEL,
  AI_RISK_LEVEL_TTL_MS,
  MAX_APPROVAL_EXECUTION_ATTEMPTS,
} from '../types/agent-approval.types';

/**
 * ApprovalService tests — Phase 3.1A.
 *
 * All 24 tests from the Phase 3.1A scope run against a mocked Prisma
 * client + a fake request. No NestJS bootstrap. Tests are organised by
 * the lifecycle stage they exercise (initiate, approve, reject, revoke,
 * cancel, execute) plus a structural section that asserts the controllers'
 * route metadata is correct (covers tests #6, #7, #22, #23, #24).
 */

describe('ApprovalService — Phase 3.1A publish_product approval workflow', () => {
  let prismaMock: any;
  let tenantContextMock: any;
  let auditMock: any;
  let publishValidatorMock: any;
  let service: ApprovalService;
  let auditCalls: Array<any>;

  const TENANT_A = 'tenant_A';
  const TENANT_B = 'tenant_B';
  const OPERATOR = 'admin_operator';
  const APPROVER = 'admin_approver';
  const NOW = new Date('2026-05-11T10:00:00Z');

  function activeRequest(req: any = {}) {
    return {
      headers: { 'x-agent-session-id': 'test-session' },
      user: { id: OPERATOR, sub: OPERATOR },
      ...req,
    };
  }

  function draftProduct(overrides: any = {}) {
    return {
      id: 'prod_draft',
      tenantId: TENANT_A,
      name: 'Floral Mermaid Gown',
      slug: 'floral-mermaid-gown',
      isActive: false,
      deletedAt: null,
      basePrice: '850000',
      availabilityMode: 'PURCHASE_ONLY',
      rentalPricePerDay: null,
      category: { id: 'cat_1', name: 'Bridal', slug: 'bridal' },
      images: [{ id: 'img_1', url: '/uploads/products/x.jpg' }],
      variants: [{ id: 'v1', isActive: true, stock: 3 }],
      updatedAt: new Date('2026-05-11T09:50:00Z'),
      ...overrides,
    };
  }

  function approvalRow(overrides: any = {}) {
    return {
      id: 'appr_1',
      tenantId: TENANT_A,
      requestedByAdminUserId: OPERATOR,
      approvedByAdminUserId: null,
      toolName: 'publish_product',
      targetResourceType: 'Product',
      targetResourceId: 'prod_draft',
      targetResourceName: 'Floral Mermaid Gown',
      inputJson: { productId: 'prod_draft' },
      payloadHash: payloadHash('publish_product', { productId: 'prod_draft' }),
      actionTitle: "Publish 'Floral Mermaid Gown'",
      businessSummary: 'Make this product visible.',
      riskLevel: AI_RISK_LEVEL.HIGH,
      beforeValues: { isActive: false },
      afterValues: { isActive: true },
      expectedUpdatedAt: new Date('2026-05-11T09:50:00Z'),
      approvalTokenHash: null,
      status: AGENT_APPROVAL_STATUS.PENDING,
      rejectionReason: null,
      expirationReason: null,
      executionAttempts: 0,
      expiresAt: new Date(NOW.getTime() + AI_RISK_LEVEL_TTL_MS.HIGH),
      approvedAt: null,
      rejectedAt: null,
      cancelledAt: null,
      revokedAt: null,
      consumedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  function makeService(req: any = activeRequest(), tenantId = TENANT_A) {
    auditCalls = [];
    auditMock = {
      record: jest.fn(async (args) => {
        auditCalls.push(args);
        return `audit_${auditCalls.length}`;
      }),
    };
    tenantContextMock = { get requireId() { return tenantId; } };
    publishValidatorMock = {
      validatePublishable: jest.fn(async () => ({
        product: draftProduct(),
        imageCount: 1,
        activeVariantCount: 1,
      })),
    };
    prismaMock = {
      product: { findFirst: jest.fn(), update: jest.fn() },
      agentApprovalRequest: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prismaMock)),
    };
    return new ApprovalService(
      req as any,
      prismaMock,
      tenantContextMock,
      auditMock,
      publishValidatorMock as PublishValidationService,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    service = makeService();
  });

  afterEach(() => jest.useRealTimers());

  // ──────────────────────────────────────────────────────────────────
  // INITIATE — tests #1, #2, #17, #18, #19
  // ──────────────────────────────────────────────────────────────────
  describe('requestPublishProduct (initiate) ', () => {
    it('#1 operator can create a publish approval request', async () => {
      prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(approvalRow());

      const summary = await service.requestPublishProduct('prod_draft');

      expect(summary.id).toBe('appr_1');
      expect(summary.status).toBe(AGENT_APPROVAL_STATUS.PENDING);
      expect(summary.tool).toBe('publish_product');
      expect(summary.riskLevel).toBe('HIGH');
      // TTL ~ 2 minutes for HIGH risk.
      expect(summary.ttlSeconds).toBeGreaterThanOrEqual(115);
      expect(summary.ttlSeconds).toBeLessThanOrEqual(120);
      // No token at request time.
      expect(summary.tokenIssued).toBe(false);
      expect(summary.approvalToken).toBeUndefined();
    });

    it('#1b writes an APPROVAL_REQUESTED audit row linked to the new approval', async () => {
      prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(approvalRow());

      await service.requestPublishProduct('prod_draft');

      expect(auditMock.record).toHaveBeenCalledTimes(1);
      const audit = auditCalls[0];
      expect(audit.actionType).toBe('APPROVAL_REQUESTED');
      expect(audit.approvalRequestId).toBe('appr_1');
      expect(audit.approvalRequired).toBe(true);
      expect(audit.status).toBe('SUCCESS');
    });

    it('#2 stored row carries payloadHash (not the raw payload)', async () => {
      prismaMock.agentApprovalRequest.create.mockImplementationOnce(
        async ({ data }: any) => ({ ...approvalRow(), ...data, id: 'appr_1' }),
      );
      await service.requestPublishProduct('prod_draft');
      const args = prismaMock.agentApprovalRequest.create.mock.calls[0][0];
      expect(args.data.payloadHash).toBe(
        payloadHash('publish_product', { productId: 'prod_draft' }),
      );
      expect(args.data.approvalTokenHash).toBeUndefined();
    });

    it('#17 soft-deleted product cannot be published', async () => {
      publishValidatorMock.validatePublishable.mockRejectedValueOnce(
        new BadRequestException('Product is soft-deleted (in the recycle bin)'),
      );
      await expect(
        service.requestPublishProduct('prod_deleted'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
    });

    it('#18 already-active product cannot be published', async () => {
      publishValidatorMock.validatePublishable.mockRejectedValueOnce(
        new BadRequestException('Product is already active'),
      );
      await expect(
        service.requestPublishProduct('prod_active'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
    });

    it('#19 product missing required publication fields cannot create approval', async () => {
      publishValidatorMock.validatePublishable.mockRejectedValueOnce(
        new BadRequestException('Product needs at least one image'),
      );
      await expect(
        service.requestPublishProduct('prod_no_image'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      expect(auditMock.record).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // APPROVE / REJECT — tests #2, #3, #4, #5, #15
  // ──────────────────────────────────────────────────────────────────
  describe('approve', () => {
    beforeEach(() => {
      // Approver is a different admin user.
      service = makeService(activeRequest({ user: { id: APPROVER, sub: APPROVER } }));
    });

    it('#4 different admin in same tenant can approve a PENDING request', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
          approvedAt: NOW,
          approvalTokenHash: 'sha256_hash_value',
        }),
      );

      const summary = await service.approve('appr_1');

      expect(summary.status).toBe(AGENT_APPROVAL_STATUS.APPROVED);
      // Raw token is returned ONCE.
      expect(typeof summary.approvalToken).toBe('string');
      expect(summary.approvalToken!.length).toBe(64); // 32 bytes hex
      expect(summary.tokenIssued).toBe(true);
    });

    it('#2 only the SHA-256 HASH is persisted — raw token is never written to the DB', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED, approvedByAdminUserId: APPROVER }),
      );

      const summary = await service.approve('appr_1');

      const updateArgs = prismaMock.agentApprovalRequest.updateMany.mock.calls[0][0];
      const storedHash = updateArgs.data.approvalTokenHash;
      expect(storedHash).toBeDefined();
      expect(storedHash).toHaveLength(64); // sha256 hex
      expect(storedHash).toBe(hashApprovalToken(summary.approvalToken!));
      // Defence-in-depth: the data clause never contains a `approvalToken`
      // raw field.
      expect((updateArgs.data as any).approvalToken).toBeUndefined();
    });

    it('#3 raw token never appears in any audit input/output payload', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED, approvedByAdminUserId: APPROVER }),
      );

      const summary = await service.approve('appr_1');

      const rawToken = summary.approvalToken!;
      for (const call of auditCalls) {
        const inputStr = JSON.stringify(call.input ?? {});
        const outputStr = JSON.stringify(call.output ?? {});
        expect(inputStr).not.toContain(rawToken);
        expect(outputStr).not.toContain(rawToken);
      }
    });

    it('#5 initiator cannot approve own request — 403 forbidden_self_approval', async () => {
      // Use the operator service (same user as initiator).
      service = makeService(activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());

      await expect(service.approve('appr_1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      // Self-approval attempt logs WARNING.
      const denial = auditCalls.find(
        (c) => c.actionType === 'SELF_APPROVAL_BLOCKED',
      );
      expect(denial).toBeTruthy();
      expect(denial.severity).toBe('WARNING');
      // No status change on the row.
      expect(prismaMock.agentApprovalRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when state is not PENDING (e.g. already APPROVED)', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED }),
      );
      await expect(service.approve('appr_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects when approval has already TTL-expired', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({ expiresAt: new Date(NOW.getTime() - 1000) }),
      );
      prismaMock.agentApprovalRequest.update = jest.fn().mockResolvedValueOnce({});
      await expect(service.approve('appr_1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('#15 tenant A approver cannot approve tenant B request (404, not 403)', async () => {
      // Approver is in tenant A; request lives in tenant B.
      service = makeService(
        activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
        TENANT_A,
      );
      // Tenant-scoped findFirst returns null → 404 (the actual production behaviour).
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.approve('appr_from_tenant_b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('records APPROVAL_GRANTED audit row with NOTICE severity on success', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED, approvedByAdminUserId: APPROVER }),
      );

      await service.approve('appr_1');

      const granted = auditCalls.find((c) => c.actionType === 'APPROVAL_GRANTED');
      expect(granted).toBeTruthy();
      expect(granted.severity).toBe('NOTICE');
      expect(granted.approvalRequestId).toBe('appr_1');
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      service = makeService(activeRequest({ user: { id: APPROVER, sub: APPROVER } }));
    });

    it('approver can reject a PENDING request with a reason', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.REJECTED,
          rejectedAt: NOW,
          approvedByAdminUserId: APPROVER,
          rejectionReason: 'wrong product',
        }),
      );

      const summary = await service.reject('appr_1', 'wrong product');

      expect(summary.status).toBe(AGENT_APPROVAL_STATUS.REJECTED);
      const updateArgs = prismaMock.agentApprovalRequest.updateMany.mock.calls[0][0];
      expect(updateArgs.data.rejectionReason).toBe('wrong product');
    });

    it('blocks self-rejection (four-eyes also applies)', async () => {
      service = makeService(activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());

      await expect(service.reject('appr_1', 'no')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // REVOKE — tests #11
  // ──────────────────────────────────────────────────────────────────
  describe('revoke', () => {
    it('only original approver can revoke an APPROVED request', async () => {
      service = makeService(activeRequest({ user: { id: APPROVER, sub: APPROVER } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
          approvalTokenHash: 'somehash',
        }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.REVOKED, revokedAt: NOW }),
      );

      const summary = await service.revoke('appr_1', 'changed my mind');

      expect(summary.status).toBe(AGENT_APPROVAL_STATUS.REVOKED);
      // Token hash MUST be cleared on revoke.
      const updateArgs = prismaMock.agentApprovalRequest.updateMany.mock.calls[0][0];
      expect(updateArgs.data.approvalTokenHash).toBeNull();
    });

    it('a different admin cannot revoke — 403 forbidden_not_original_approver', async () => {
      const DIFFERENT = 'admin_someone_else';
      service = makeService(activeRequest({ user: { id: DIFFERENT, sub: DIFFERENT } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
        }),
      );
      await expect(service.revoke('appr_1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('cannot revoke a non-APPROVED request', async () => {
      service = makeService(activeRequest({ user: { id: APPROVER, sub: APPROVER } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.PENDING }),
      );
      await expect(service.revoke('appr_1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('only initiator can cancel a PENDING request', async () => {
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.CANCELLED, cancelledAt: NOW }),
      );
      const summary = await service.cancel('appr_1');
      expect(summary.status).toBe(AGENT_APPROVAL_STATUS.CANCELLED);
    });

    it('non-initiator cannot cancel — 403', async () => {
      service = makeService(activeRequest({ user: { id: 'someone_else', sub: 'someone_else' } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      await expect(service.cancel('appr_1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // EXECUTE — tests #8, #9, #10, #11, #12, #13, #14, #16, #20, #21
  // ──────────────────────────────────────────────────────────────────
  describe('execute (consume token + write)', () => {
    // We always test execute under the OPERATOR (= original initiator)
    // identity; tests that assert wrong-initiator behaviour switch user
    // explicitly.

    function approvedRow(rawToken: string, overrides: any = {}) {
      return approvalRow({
        status: AGENT_APPROVAL_STATUS.APPROVED,
        approvedByAdminUserId: APPROVER,
        approvedAt: NOW,
        approvalTokenHash: hashApprovalToken(rawToken),
        ...overrides,
      });
    }

    it('#20 successful execution flips product to isActive=true and returns the new state', async () => {
      const rawToken = 'a'.repeat(64);
      const row = approvedRow(rawToken);
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(row);
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 }); // bump
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      // In-transaction: claim CONSUMED then update product
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_draft',
        slug: 'floral-mermaid-gown',
        isActive: true,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.CONSUMED,
          consumedAt: NOW,
          approvalTokenHash: null,
        }),
      );

      const result = await service.execute('appr_1', rawToken);

      expect(result.data.isActive).toBe(true);
      expect(result.approvalRequest.status).toBe(AGENT_APPROVAL_STATUS.CONSUMED);
      // The publish_product update was issued.
      expect(prismaMock.product.update).toHaveBeenCalledWith({
        where: { id: 'prod_draft' },
        data: { isActive: true },
      });
    });

    it('#21 successful execution writes a PUBLISH audit row linked to approval', async () => {
      const rawToken = 'b'.repeat(64);
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedRow(rawToken));
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_draft',
        slug: 'floral-mermaid-gown',
        isActive: true,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
      );

      await service.execute('appr_1', rawToken);

      const publish = auditCalls.find((c) => c.actionType === 'PUBLISH');
      expect(publish).toBeTruthy();
      expect(publish.approvalRequestId).toBe('appr_1');
      expect(publish.status).toBe('SUCCESS');
      expect(publish.severity).toBe('NOTICE'); // HIGH → NOTICE
    });

    it('#8 payload hash mismatch blocks execution and invalidates approval', async () => {
      const rawToken = 'c'.repeat(64);
      // The stored row carries a mismatched payloadHash (i.e. someone
      // tampered with the inputJson column).
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvedRow(rawToken, { payloadHash: 'completely_different_hash' }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 }); // bump
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 }); // invalidate

      await expect(
        service.execute('appr_1', rawToken),
      ).rejects.toBeInstanceOf(ConflictException);

      // The status flip to EXPIRED happened.
      const calls = prismaMock.agentApprovalRequest.updateMany.mock.calls;
      const invalidate = calls.find(
        (c: any) => c[0].data.expirationReason === 'payload_mismatch',
      );
      expect(invalidate).toBeTruthy();
      expect(invalidate[0].data.status).toBe(AGENT_APPROVAL_STATUS.EXPIRED);
      expect(invalidate[0].data.approvalTokenHash).toBeNull();
    });

    it('#9 expectedUpdatedAt mismatch returns stale_data and invalidates approval', async () => {
      const rawToken = 'd'.repeat(64);
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedRow(rawToken));
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 }); // bump
      // Product's updatedAt drifted compared to the row's expectedUpdatedAt.
      prismaMock.product.findFirst.mockResolvedValueOnce(
        draftProduct({ updatedAt: new Date('2026-05-11T09:59:00Z') }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(
        service.execute('appr_1', rawToken),
      ).rejects.toMatchObject({
        response: { code: 'stale_data' },
      });
      const calls = prismaMock.agentApprovalRequest.updateMany.mock.calls;
      const invalidate = calls.find(
        (c: any) => c[0].data.expirationReason === 'stale_data',
      );
      expect(invalidate).toBeTruthy();
      expect(invalidate[0].data.status).toBe(AGENT_APPROVAL_STATUS.EXPIRED);
      expect(invalidate[0].data.approvalTokenHash).toBeNull();
    });

    it('#10 expired (TTL-exceeded) approval cannot execute', async () => {
      const rawToken = 'e'.repeat(64);
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvedRow(rawToken, { expiresAt: new Date(NOW.getTime() - 1) }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(service.execute('appr_1', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_expired' },
      });
    });

    it('#11 revoked approval cannot execute (no token matches)', async () => {
      const rawToken = 'f'.repeat(64);
      // After revoke, the hash is cleared — the lookup `WHERE approvalTokenHash = ?`
      // returns no row.
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.execute('appr_revoked', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_invalid_or_consumed' },
      });
    });

    it('#12 rejected approval cannot execute', async () => {
      const rawToken = 'g'.repeat(64);
      // Hash never set after reject; lookup returns null.
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.execute('appr_rejected', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_invalid_or_consumed' },
      });
    });

    it('#13 consumed approval cannot execute twice (hash cleared after consume)', async () => {
      const rawToken = 'h'.repeat(64);
      // First call already consumed the row; second lookup by hash returns null.
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.execute('appr_done', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_invalid_or_consumed' },
      });
    });

    it('#14 4th execute attempt returns approval_exhausted', async () => {
      const rawToken = 'i'.repeat(64);
      // The bump fails because executionAttempts >= 3.
      prismaMock.agentApprovalRequest.findFirst
        .mockResolvedValueOnce(
          approvedRow(rawToken, { executionAttempts: 3 }),
        );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvedRow(rawToken, { executionAttempts: 3 }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(service.execute('appr_max', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_exhausted' },
      });

      // Status flipped to EXHAUSTED + hash cleared.
      const calls = prismaMock.agentApprovalRequest.updateMany.mock.calls;
      const exhaustCall = calls.find(
        (c: any) => c[0].data.status === AGENT_APPROVAL_STATUS.EXHAUSTED,
      );
      expect(exhaustCall).toBeTruthy();
      expect(exhaustCall[0].data.approvalTokenHash).toBeNull();
      const exhaustAudit = auditCalls.find(
        (c) => c.actionType === 'APPROVAL_EXHAUSTED',
      );
      expect(exhaustAudit).toBeTruthy();
      expect(exhaustAudit.severity).toBe('WARNING');
    });

    it('#14b executionAttempts is enforced via the pre-flight bump (lt:3 guard)', async () => {
      const rawToken = 'j'.repeat(64);
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedRow(rawToken));
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_draft',
        slug: 'floral-mermaid-gown',
        isActive: true,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
      );

      await service.execute('appr_1', rawToken);

      const bumpCall = prismaMock.agentApprovalRequest.updateMany.mock.calls[0][0];
      expect(bumpCall.where.executionAttempts).toEqual({
        lt: MAX_APPROVAL_EXECUTION_ATTEMPTS,
      });
      expect(bumpCall.data.executionAttempts).toEqual({ increment: 1 });
    });

    it('#16 tenant A cannot execute tenant B request (token-hash lookup is tenant-scoped)', async () => {
      const rawToken = 'k'.repeat(64);
      // tenant A operator; the row only matches if tenantId == A,
      // but our mocked findFirst returns null for the wrong tenant.
      service = makeService(
        activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
        TENANT_A,
      );
      prismaMock.agentApprovalRequest.findFirst.mockImplementationOnce(
        ({ where }: any) => {
          // Simulate row sitting in tenant B; our where clause carries
          // tenantId=A so no row matches.
          return Promise.resolve(where.tenantId === TENANT_B ? approvalRow() : null);
        },
      );
      await expect(service.execute('appr_b', rawToken)).rejects.toMatchObject({
        response: { code: 'approval_invalid_or_consumed' },
      });
    });

    it('rejects when caller is not the original initiator', async () => {
      const rawToken = 'm'.repeat(64);
      // Approver tries to consume — must be initiator.
      service = makeService(activeRequest({ user: { id: APPROVER, sub: APPROVER } }));
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedRow(rawToken));
      await expect(service.execute('appr_1', rawToken)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects empty / missing approvalToken with 400', async () => {
      await expect(service.execute('appr_1', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // STRUCTURAL — tests #6, #7, #22, #23, #24
  // ──────────────────────────────────────────────────────────────────
  describe('Phase 3.1A structural invariants', () => {
    const productsControllerPath = join(
      __dirname,
      '..',
      'controllers',
      'products.ai.controller.ts',
    );
    const approvalsControllerPath = join(
      __dirname,
      '..',
      'controllers',
      'approvals.ai.controller.ts',
    );
    const productsSrc = readFileSync(productsControllerPath, 'utf8');
    const approvalsSrc = readFileSync(approvalsControllerPath, 'utf8');

    it('#6 approve / reject / revoke routes require ai-agent:approve', () => {
      // Every @Post for approve/reject/revoke is preceded by
      // @RequiresAiPermission(AI_PERMISSION_CODES.APPROVE).
      const re =
        /@RequiresAiPermission\(AI_PERMISSION_CODES\.APPROVE\)[\s\S]{1,200}?@Post\(':id\/(approve|reject|revoke)'\)/g;
      const matches = approvalsSrc.match(re) ?? [];
      expect(matches.length).toBe(3);
    });

    it('#7 publish request-approval route requires ai-agent:write-drafts (initiator-side perm)', () => {
      const re =
        /@RequiresAiPermission\(AI_PERMISSION_CODES\.WRITE_DRAFTS\)[\s\S]{1,400}?@Post\(':id\/publish\/request-approval'\)/;
      expect(productsSrc).toMatch(re);
    });

    it('#22 existing Phase 1/2 routes still in place (search + getOne + draft + 4 other write-draft controllers)', () => {
      // Search + getOne + draft on products controller.
      expect(productsSrc).toMatch(/@Get\('search'\)/);
      expect(productsSrc).toMatch(/@Get\(':id'\)/);
      expect(productsSrc).toMatch(/@Post\('draft'\)/);
      // Other Phase 2 write-draft controllers untouched (file presence).
      const otherDrafts = [
        'orders.ai.controller.ts',
        'size-guide.ai.controller.ts',
        'product-sizes.ai.controller.ts',
      ];
      for (const file of otherDrafts) {
        const src = readFileSync(
          join(__dirname, '..', 'controllers', file),
          'utf8',
        );
        expect(src).toMatch(/@Post/);
      }
    });

    it('#23 pricing field block still works — basePrice / rentalPricePerDay rejected on draft DTO', () => {
      const dtoPath = join(
        __dirname,
        '..',
        'dto',
        'create-product-draft.ai.dto.ts',
      );
      const dtoSrc = readFileSync(dtoPath, 'utf8');
      // DTO is allow-list shaped via class-validator decorators. The
      // forbidden fields simply aren't declared; combined with the global
      // ValidationPipe `forbidNonWhitelisted: true` they 400 on the wire.
      const FORBIDDEN = [
        'basePrice',
        'compareAtPrice',
        'rentalPricePerDay',
        'rentalDepositAmount',
        'price',
      ];
      for (const f of FORBIDDEN) {
        expect(dtoSrc).not.toMatch(new RegExp(`^\\s+${f}\\s*[!?:]`, 'm'));
      }
    });

    it('#24 NO inventory/rental/order/permanent-delete/payment write routes exist', () => {
      const forbidden = [
        '/adjust',
        '/return',
        '/permanent-delete',
        '/refund',
        '/refunds',
        ':id/status',
      ];
      const dir = join(__dirname, '..', 'controllers');
      const fs = require('fs');
      const files = fs
        .readdirSync(dir)
        .filter(
          (f: string) =>
            f.endsWith('.ai.controller.ts') && !f.endsWith('.spec.ts'),
        );
      for (const file of files) {
        const src = readFileSync(join(dir, file), 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        for (const f of forbidden) {
          // Match @Post('...<fragment>...') only, so prose inside
          // `tool: 'execute_approval'` etc. doesn't false-positive.
          const re = new RegExp(
            `@(Post|Patch|Put|Delete)\\([^)]*${escapeRegex(f)}[^)]*\\)`,
          );
          if (re.test(stripped)) {
            throw new Error(`Forbidden write route found in ${file}: ${f}`);
          }
        }
      }
    });

    it('approve route uses auditOutput to strip raw token from the runner audit row', () => {
      // Critical: the runner's default behaviour is to persist the
      // handler's return value as outputJson. The approve handler
      // returns the raw token. Without auditOutput, the raw token
      // would land in the unlinked runner audit row (we caught this
      // in production smoke on 2026-05-11). The fix is the
      // auditOutput transform that strips `approvalToken` before
      // audit. This test asserts the transform exists in the source.
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Match the auditOutput key inside the approve route's runner.run({...}).
      const approveBlock = stripped.match(
        /@Post\(':id\/approve'\)[\s\S]+?@RequiresAiPermission|@Post\(':id\/approve'\)[\s\S]+?\}\)/,
      );
      expect(approveBlock).toBeTruthy();
      const block = approveBlock![0];
      expect(block).toContain('auditOutput');
      // Specifically: it MUST destructure approvalToken out.
      expect(block).toMatch(/approvalToken\s*,\s*\.\.\.redacted/);
    });

    it('canonicalJSON is order-insensitive (payload-hash binding test)', () => {
      const a = canonicalJSON({ x: 1, y: 2, z: { b: 'B', a: 'A' } });
      const b = canonicalJSON({ z: { a: 'A', b: 'B' }, y: 2, x: 1 });
      expect(a).toBe(b);
    });

    it('canonicalJSON: numbers and strings do NOT unify (type-preserving)', () => {
      expect(canonicalJSON({ x: 1 })).not.toBe(canonicalJSON({ x: '1' }));
    });
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
