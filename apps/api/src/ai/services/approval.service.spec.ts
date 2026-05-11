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
  let archiveValidatorMock: any;
  let restoreValidatorMock: any;
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

  /**
   * Active product fixture for archive_product tests — same row shape as
   * `draftProduct` but with `isActive: true`. The archive validator's
   * loader uses `select`, not `include`, so it doesn't return the
   * category/images/variants nested relations. Keeping them here is
   * harmless — extra keys aren't asserted negatively anywhere.
   */
  function activeProduct(overrides: any = {}) {
    return {
      id: 'prod_active',
      tenantId: TENANT_A,
      name: 'Ivory Beaded Ball Gown',
      slug: 'ivory-beaded-ball-gown',
      isActive: true,
      deletedAt: null,
      archivedAt: null,
      basePrice: '750000',
      availabilityMode: 'PURCHASE_ONLY',
      updatedAt: new Date('2026-05-11T09:50:00Z'),
      ...overrides,
    };
  }

  /**
   * Archived product fixture for restore_product tests — was active, now
   * inactive with `archivedAt` stamped. Returned by the mocked
   * RestoreValidationService.validateRestorable() in the default factory.
   */
  function archivedProductFixture(overrides: any = {}) {
    return {
      id: 'prod_archived',
      tenantId: TENANT_A,
      name: 'Previously Active Gown',
      slug: 'previously-active-gown',
      isActive: false,
      deletedAt: null,
      archivedAt: new Date('2026-05-10T08:00:00Z'),
      basePrice: '900000',
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
    archiveValidatorMock = {
      validateArchivable: jest.fn(async () => ({
        product: activeProduct(),
      })),
    };
    restoreValidatorMock = {
      validateRestorable: jest.fn(async () => ({
        product: archivedProductFixture(),
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
      archiveValidatorMock,
      restoreValidatorMock,
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
      // The publish_product update was issued — Phase 3.1B.α adds the
      // `archivedAt: null` clear alongside the `isActive: true` flip so a
      // future restore_product writes through the same shape.
      const updateCall = prismaMock.product.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'prod_draft' });
      expect(updateCall.data.isActive).toBe(true);
      expect(updateCall.data.archivedAt).toBeNull();
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

  // ══════════════════════════════════════════════════════════════════
  // restore_product — Phase 3.1B.β (2026-05-11)
  //
  // Third lifecycle verb after publish + archive. Brings an ARCHIVED
  // row back to ACTIVE. Validator gates on archivedAt: not null so a
  // DRAFT can NOT use this verb. Consume write is functionally
  // identical to publish (`isActive: true, archivedAt: null`); the
  // only difference between publish and restore is which validator
  // runs at request-approval AND execute time.
  // ══════════════════════════════════════════════════════════════════
  describe('restore_product — request, approve, execute', () => {
    function approvalRestoreRow(overrides: any = {}) {
      return approvalRow({
        id: 'appr_restore_1',
        toolName: 'restore_product',
        targetResourceId: 'prod_archived',
        targetResourceName: 'Previously Active Gown',
        actionTitle: "Restore 'Previously Active Gown'",
        beforeValues: {
          isActive: false,
          archivedAt: '2026-05-10T08:00:00.000Z',
        },
        afterValues: { isActive: true, archivedAt: null },
        payloadHash: payloadHash('restore_product', {
          productId: 'prod_archived',
        }),
        inputJson: { productId: 'prod_archived' },
        ...overrides,
      });
    }

    // ─── INITIATE — tests R1, R2, R3, R4, R5, R6, R7 ────────────────
    describe('requestRestoreProduct (initiate)', () => {
      it('R1 operator can create restore approval for an archived product', async () => {
        prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(
          approvalRestoreRow(),
        );
        const summary = await service.requestRestoreProduct('prod_archived');
        expect(summary.tool).toBe('restore_product');
        expect(summary.status).toBe(AGENT_APPROVAL_STATUS.PENDING);
        expect(summary.riskLevel).toBe('HIGH');
        expect(summary.tokenIssued).toBe(false);
        expect(summary.approvalToken).toBeUndefined();
      });

      it('R1b writes APPROVAL_REQUESTED audit row linked to the new approval', async () => {
        prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(
          approvalRestoreRow(),
        );
        await service.requestRestoreProduct('prod_archived');
        expect(auditMock.record).toHaveBeenCalledTimes(1);
        const audit = auditCalls[0];
        expect(audit.actionType).toBe('APPROVAL_REQUESTED');
        expect(audit.tool).toBe('restore_product');
        expect(audit.approvalRequestId).toBe('appr_restore_1');
        expect(audit.approvalRequired).toBe(true);
      });

      it('R2 draft product (archivedAt: null) cannot be restored', async () => {
        restoreValidatorMock.validateRestorable.mockRejectedValueOnce(
          new BadRequestException(
            'This product is a draft, not an archived product. Use publish_product instead.',
          ),
        );
        await expect(
          service.requestRestoreProduct('prod_draft_only'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
        expect(auditMock.record).not.toHaveBeenCalled();
      });

      it('R3 active product cannot be restored', async () => {
        restoreValidatorMock.validateRestorable.mockRejectedValueOnce(
          new BadRequestException(
            'Product is already active. Nothing to restore.',
          ),
        );
        await expect(
          service.requestRestoreProduct('prod_active_running'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('R4 soft-deleted product cannot be restored via restore_product (recycle-bin path is separate)', async () => {
        restoreValidatorMock.validateRestorable.mockRejectedValueOnce(
          new BadRequestException(
            'Product is soft-deleted (in the recycle bin).',
          ),
        );
        await expect(
          service.requestRestoreProduct('prod_in_recycle'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('R5 cross-tenant product cannot be restored (validator returns "not found" for wrong tenant)', async () => {
        restoreValidatorMock.validateRestorable.mockRejectedValueOnce(
          new BadRequestException(
            'Product prod_other_tenant not found in this tenant — cannot restore.',
          ),
        );
        await expect(
          service.requestRestoreProduct('prod_other_tenant'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('R6 stored row carries correct before/after values (state flip + archivedAt)', async () => {
        prismaMock.agentApprovalRequest.create.mockImplementationOnce(
          async ({ data }: any) => ({
            ...approvalRestoreRow(),
            ...data,
            id: 'appr_restore_1',
          }),
        );
        await service.requestRestoreProduct('prod_archived');
        const args =
          prismaMock.agentApprovalRequest.create.mock.calls[0][0];
        expect(args.data.beforeValues).toMatchObject({
          isActive: false,
          archivedAt: expect.any(String), // ISO timestamp of pre-restore state
        });
        expect(args.data.afterValues).toMatchObject({
          isActive: true,
          archivedAt: null,
        });
        expect(args.data.actionTitle).toMatch(/^Restore '.+'$/);
        expect(args.data.targetResourceType).toBe('Product');
      });

      it('R7 stored row carries expectedUpdatedAt + payloadHash bound to (toolName, productId)', async () => {
        const ts = new Date('2026-05-11T09:50:00Z');
        restoreValidatorMock.validateRestorable.mockResolvedValueOnce({
          product: archivedProductFixture({ updatedAt: ts }),
        });
        prismaMock.agentApprovalRequest.create.mockImplementationOnce(
          async ({ data }: any) => ({
            ...approvalRestoreRow(),
            ...data,
            id: 'appr_restore_1',
          }),
        );
        await service.requestRestoreProduct('prod_archived');
        const args =
          prismaMock.agentApprovalRequest.create.mock.calls[0][0];
        expect(args.data.expectedUpdatedAt).toEqual(ts);
        expect(args.data.payloadHash).toBe(
          payloadHash('restore_product', { productId: 'prod_archived' }),
        );
        // Distinct from publish_product's hash for the same id.
        expect(args.data.payloadHash).not.toBe(
          payloadHash('publish_product', { productId: 'prod_archived' }),
        );
        // approvalTokenHash NEVER persists at request time.
        expect(args.data.approvalTokenHash).toBeUndefined();
      });
    });

    // ─── APPROVE — tests R8, R9, R10 ─────────────────────────────────
    describe('approve (restore)', () => {
      beforeEach(() => {
        service = makeService(
          activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
        );
      });

      it('R8 initiator cannot approve own restore request', async () => {
        service = makeService(
          activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
        );
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalRestoreRow(),
        );
        await expect(
          service.approve('appr_restore_1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        const blocked = auditCalls.find(
          (c) => c.actionType === 'SELF_APPROVAL_BLOCKED',
        );
        expect(blocked).toBeTruthy();
        expect(blocked.tool).toBe('restore_product');
        expect(blocked.severity).toBe('WARNING');
      });

      it('R9 different approver approves + receives raw token exactly once', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalRestoreRow(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalRestoreRow({
            status: AGENT_APPROVAL_STATUS.APPROVED,
            approvedByAdminUserId: APPROVER,
          }),
        );
        const summary = await service.approve('appr_restore_1');
        expect(summary.status).toBe(AGENT_APPROVAL_STATUS.APPROVED);
        expect(summary.approvalToken).toMatch(/^[a-f0-9]{64}$/);
        expect(summary.tokenIssued).toBe(true);
      });

      it('R10 raw token never appears in any audit input/output during restore approve', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalRestoreRow(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalRestoreRow({
            status: AGENT_APPROVAL_STATUS.APPROVED,
            approvedByAdminUserId: APPROVER,
          }),
        );
        const summary = await service.approve('appr_restore_1');
        const rawToken = summary.approvalToken!;
        for (const call of auditCalls) {
          const inputStr = JSON.stringify(call.input ?? {});
          const outputStr = JSON.stringify(call.output ?? {});
          expect(inputStr).not.toContain(rawToken);
          expect(outputStr).not.toContain(rawToken);
          expect(inputStr).not.toMatch(/[a-f0-9]{64}/);
          expect(outputStr).not.toMatch(/[a-f0-9]{64}/);
        }
      });
    });

    // ─── EXECUTE — tests R11, R12, R13, R14, R15, R16, R17 ─────────
    describe('execute (restore)', () => {
      function approvedRestoreRow(rawToken: string, overrides: any = {}) {
        return approvalRestoreRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
          approvedAt: NOW,
          approvalTokenHash: hashApprovalToken(rawToken),
          ...overrides,
        });
      }

      it('R11 successful execute flips product to isActive=true AND archivedAt=null', async () => {
        const rawToken = 'a'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(
          archivedProductFixture(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_archived',
          slug: 'previously-active-gown',
          isActive: true,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalRestoreRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );
        const result = await service.execute('appr_restore_1', rawToken);
        expect(result.data.isActive).toBe(true);
        expect(result.approvalRequest.status).toBe(
          AGENT_APPROVAL_STATUS.CONSUMED,
        );
        const writeCall = prismaMock.product.update.mock.calls[0][0];
        expect(writeCall.where).toEqual({ id: 'prod_archived' });
        expect(writeCall.data.isActive).toBe(true);
        expect(writeCall.data.archivedAt).toBeNull();
      });

      it('R12 execute does NOT modify deletedAt (restore is not a recycle-bin operation)', async () => {
        const rawToken = 'b'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(
          archivedProductFixture(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_archived',
          slug: 'previously-active-gown',
          isActive: true,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalRestoreRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );
        await service.execute('appr_restore_1', rawToken);
        const writeCall = prismaMock.product.update.mock.calls[0][0];
        expect('deletedAt' in writeCall.data).toBe(false);
      });

      it('R13 success writes a linked RESTORE audit row (not PUBLISH, not ARCHIVE)', async () => {
        const rawToken = 'c'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(
          archivedProductFixture(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_archived',
          slug: 'previously-active-gown',
          isActive: true,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalRestoreRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );
        await service.execute('appr_restore_1', rawToken);
        const restoreAudit = auditCalls.find(
          (c) => c.actionType === 'RESTORE',
        );
        expect(restoreAudit).toBeTruthy();
        expect(restoreAudit.tool).toBe('restore_product');
        expect(restoreAudit.approvalRequestId).toBe('appr_restore_1');
        expect(restoreAudit.severity).toBe('NOTICE');
        // No raw token literal anywhere.
        expect(JSON.stringify(restoreAudit.input)).not.toMatch(
          /[a-f0-9]{64}/,
        );
        expect(JSON.stringify(restoreAudit.output)).not.toMatch(
          /[a-f0-9]{64}/,
        );
        // Verify no ARCHIVE / PUBLISH audit rows were also written —
        // the dispatch should hit exactly ONE successActionType.
        expect(auditCalls.find((c) => c.actionType === 'ARCHIVE')).toBeFalsy();
        expect(auditCalls.find((c) => c.actionType === 'PUBLISH')).toBeFalsy();
      });

      it('R14 stale expectedUpdatedAt fails with stale_data + invalidates approval', async () => {
        const rawToken = 'd'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        // Live product's updatedAt drifted compared to expectedUpdatedAt.
        prismaMock.product.findFirst.mockResolvedValueOnce(
          archivedProductFixture({
            updatedAt: new Date('2026-05-11T09:59:59Z'),
          }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        await expect(
          service.execute('appr_restore_1', rawToken),
        ).rejects.toMatchObject({ response: { code: 'stale_data' } });
        const invalidate = prismaMock.agentApprovalRequest.updateMany.mock.calls.find(
          (c: any) => c[0].data.expirationReason === 'stale_data',
        );
        expect(invalidate).toBeTruthy();
        expect(invalidate[0].data.status).toBe(
          AGENT_APPROVAL_STATUS.EXPIRED,
        );
        expect(invalidate[0].data.approvalTokenHash).toBeNull();
      });

      it('R15 payload hash mismatch blocks execution + invalidates approval', async () => {
        const rawToken = 'e'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken, {
            payloadHash: 'completely_different_hash',
          }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(
          archivedProductFixture(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        await expect(
          service.execute('appr_restore_1', rawToken),
        ).rejects.toBeInstanceOf(ConflictException);
        const invalidate = prismaMock.agentApprovalRequest.updateMany.mock.calls.find(
          (c: any) => c[0].data.expirationReason === 'payload_mismatch',
        );
        expect(invalidate).toBeTruthy();
        expect(invalidate[0].data.status).toBe(
          AGENT_APPROVAL_STATUS.EXPIRED,
        );
        expect(invalidate[0].data.approvalTokenHash).toBeNull();
      });

      it('R16a expired approval cannot execute', async () => {
        const rawToken = 'f'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedRestoreRow(rawToken, {
            expiresAt: new Date(NOW.getTime() - 1000),
          }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        await expect(
          service.execute('appr_restore_1', rawToken),
        ).rejects.toMatchObject({ response: { code: 'approval_expired' } });
      });

      it('R16b rejected/revoked/consumed approval cannot execute (hash cleared → no row matches)', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.execute('appr_restore_1', 'x'.repeat(64)),
        ).rejects.toMatchObject({
          response: { code: 'approval_invalid_or_consumed' },
        });
      });

      it('R17a tenant A cannot execute tenant B restore (token-hash lookup is tenant-scoped)', async () => {
        const rawToken = 'g'.repeat(64);
        service = makeService(
          activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
          TENANT_A,
        );
        prismaMock.agentApprovalRequest.findFirst.mockImplementationOnce(
          ({ where }: any) =>
            Promise.resolve(
              where.tenantId === TENANT_B ? approvalRestoreRow() : null,
            ),
        );
        await expect(
          service.execute('appr_restore_b', rawToken),
        ).rejects.toMatchObject({
          response: { code: 'approval_invalid_or_consumed' },
        });
      });

      it('R17b tenant A cannot approve tenant B restore request (404, not 403)', async () => {
        service = makeService(
          activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
          TENANT_A,
        );
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.approve('appr_restore_from_tenant_b'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    // ─── STRUCTURAL — tests R18, R19, R20, R21, R22 ─────────────────
    describe('Phase 3.1B.β structural invariants', () => {
      const productsControllerPath = join(
        __dirname,
        '..',
        'controllers',
        'products.ai.controller.ts',
      );
      const productsSrc = readFileSync(productsControllerPath, 'utf8');

      it('R18 existing publish_product flow still wired (sanity)', () => {
        expect(productsSrc).toMatch(/@Post\(':id\/publish\/request-approval'\)/);
      });

      it('R19 existing archive_product flow still wired (sanity)', () => {
        expect(productsSrc).toMatch(/@Post\(':id\/archive\/request-approval'\)/);
      });

      it('R20 no direct restore route — only :id/restore/request-approval', () => {
        const stripped = productsSrc
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        expect(stripped).not.toMatch(/@Post\(':id\/restore'\)/);
        expect(stripped).not.toMatch(/@Patch\(':id\/restore'/);
        expect(stripped).not.toMatch(/@Delete\(':id\/restore'/);
        // And the request-approval form is the only legitimate path.
        expect(stripped).toMatch(/@Post\(':id\/restore\/request-approval'\)/);
      });

      it('R21 no inventory/order/rental/payment/permanent-delete routes exist', () => {
        const forbidden = [
          '/adjust',
          ':id/return',
          '/permanent-delete',
          '/refund',
          ':id/status',
          'rental-policies',
        ];
        const fs = require('fs');
        const dir = join(__dirname, '..', 'controllers');
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
            const re = new RegExp(
              `@(Post|Patch|Put|Delete)\\([^)]*${escapeRegex(f)}[^)]*\\)`,
            );
            if (re.test(stripped)) {
              throw new Error(`Forbidden write route found in ${file}: ${f}`);
            }
          }
        }
      });

      it('R22 token hardening invariants still pass: execute audit input shape is still tokenProvided/tokenHashPrefix only (regression guard)', () => {
        const approvalsCtrlPath = join(
          __dirname,
          '..',
          'controllers',
          'approvals.ai.controller.ts',
        );
        const src = readFileSync(approvalsCtrlPath, 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        // The tokenProvided boolean + tokenHashPrefix (6 hex) must still
        // be the only shape the controller hands to the runner.
        expect(stripped).toMatch(/tokenProvided:\s*!!dto\.approvalToken/);
        expect(stripped).toMatch(
          /hashApprovalToken\([^)]*\)\.slice\(\s*0\s*,\s*6\s*\)/,
        );
        // And the controller must NEVER hand the raw token to runner.input.
        expect(stripped).not.toMatch(
          /input:\s*\{[^}]*approvalToken:\s*dto\.approvalToken/,
        );
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // archivedAt lifecycle marker — Phase 3.1B.α (2026-05-11)
  //
  // PR-α prerequisite for restore_product: distinguish DRAFT (never
  // published) from ARCHIVED (was active, then hidden by archive_product)
  // via a new nullable timestamp column on Product. These tests assert:
  //   - archive_product execute stamps `archivedAt: Date` (and never
  //     touches `deletedAt`).
  //   - publish_product execute clears `archivedAt: null`.
  //   - publish_product validator rejects archived rows with the
  //     "use restore_product" message.
  // The state-shape assertions on the actual update calls live in the
  // existing publish/archive describe blocks above (#20, #A12) — this
  // block focuses on the new rejection path and audit-shape that's
  // unique to the lifecycle marker.
  // ══════════════════════════════════════════════════════════════════
  describe('archivedAt lifecycle marker — Phase 3.1B.α', () => {
    function archivedProduct(overrides: any = {}) {
      // A row that's already been through archive_product: isActive=false
      // AND archivedAt set. publish_product MUST reject these.
      return draftProduct({
        id: 'prod_archived',
        isActive: false,
        deletedAt: null,
        archivedAt: new Date('2026-05-10T08:00:00Z'),
        name: 'Previously Active Gown',
        slug: 'previously-active-gown',
        basePrice: '900000',
        ...overrides,
      });
    }

    it('publish validator REJECTS an archived product with the "use restore_product" hint', async () => {
      // Wire the real validator from the actual module — the service
      // mock can't catch the new branch because it only returns
      // `{ product }` blindly. Build a one-off validator with a mocked
      // Prisma read that returns the archived row.
      const {
        PublishValidationService,
      } = require('./publish-validation.service') as typeof import('./publish-validation.service');
      const validator = new PublishValidationService({
        product: {
          findFirst: jest.fn().mockResolvedValue(archivedProduct()),
        },
      } as any);
      await expect(
        validator.validatePublishable('prod_archived', TENANT_A),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/archived.*restore_product/i),
      });
    });

    it('publish validator ALLOWS a draft (archivedAt=null, isActive=false)', async () => {
      const {
        PublishValidationService,
      } = require('./publish-validation.service') as typeof import('./publish-validation.service');
      const validator = new PublishValidationService({
        product: {
          findFirst: jest.fn().mockResolvedValue(
            draftProduct({ archivedAt: null }),
          ),
        },
      } as any);
      const result = await validator.validatePublishable(
        'prod_draft',
        TENANT_A,
      );
      expect(result.product?.id).toBe('prod_draft');
      expect(result.imageCount).toBeGreaterThanOrEqual(1);
    });

    it('archive_product execute writes { isActive: false, archivedAt: <Date> } and does NOT set deletedAt', async () => {
      // Hits the dispatch in ApprovalService.execute() — same flow as the
      // existing archive happy-path test, but with explicit assertions on
      // the new archivedAt write path.
      const rawToken = 'L'.repeat(64);
      // Construct an APPROVED archive row directly so we don't have to
      // duplicate the approve() setup.
      const approvedArchive = approvalRow({
        id: 'appr_α_archive',
        toolName: 'archive_product',
        status: AGENT_APPROVAL_STATUS.APPROVED,
        approvedByAdminUserId: APPROVER,
        approvedAt: NOW,
        approvalTokenHash: hashApprovalToken(rawToken),
        targetResourceId: 'prod_active',
        targetResourceName: 'Ivory',
        payloadHash: payloadHash('archive_product', { productId: 'prod_active' }),
        inputJson: { productId: 'prod_active' },
        expectedUpdatedAt: new Date('2026-05-11T09:50:00Z'),
      });
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedArchive);
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_active',
        slug: 'ivory-beaded-ball-gown',
        isActive: false,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ id: 'appr_α_archive', status: AGENT_APPROVAL_STATUS.CONSUMED }),
      );

      await service.execute('appr_α_archive', rawToken);

      const writeCall = prismaMock.product.update.mock.calls[0][0];
      expect(writeCall.data.isActive).toBe(false);
      expect(writeCall.data.archivedAt).toBeInstanceOf(Date);
      expect('deletedAt' in writeCall.data).toBe(false);
    });

    it('publish_product execute writes { isActive: true, archivedAt: null } (idempotent clear)', async () => {
      const rawToken = 'M'.repeat(64);
      const approvedPublish = approvalRow({
        id: 'appr_α_publish',
        toolName: 'publish_product',
        status: AGENT_APPROVAL_STATUS.APPROVED,
        approvedByAdminUserId: APPROVER,
        approvedAt: NOW,
        approvalTokenHash: hashApprovalToken(rawToken),
        targetResourceId: 'prod_draft',
        approvalTokenHash_unused_keeper: undefined, // ignored extra
        payloadHash: payloadHash('publish_product', { productId: 'prod_draft' }),
        inputJson: { productId: 'prod_draft' },
        expectedUpdatedAt: new Date('2026-05-11T09:50:00Z'),
      });
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvedPublish);
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_draft',
        slug: 'floral-mermaid-gown',
        isActive: true,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ id: 'appr_α_publish', status: AGENT_APPROVAL_STATUS.CONSUMED }),
      );

      await service.execute('appr_α_publish', rawToken);

      const writeCall = prismaMock.product.update.mock.calls[0][0];
      expect(writeCall.data.isActive).toBe(true);
      // Explicit null clear — not undefined, not omitted.
      expect(writeCall.data.archivedAt).toBeNull();
    });

    it('publish_product validator chain: archived check fires BEFORE field-content checks (operator gets the right hint)', async () => {
      // If both checks fired in the wrong order, an operator trying to
      // publish an archived row with no images would get "missing images"
      // instead of "use restore_product" — confusing. Assert the order
      // explicitly by setting up a row that fails BOTH checks and
      // verifying the archived message wins.
      const {
        PublishValidationService,
      } = require('./publish-validation.service') as typeof import('./publish-validation.service');
      const validator = new PublishValidationService({
        product: {
          findFirst: jest.fn().mockResolvedValue(
            archivedProduct({ images: [], basePrice: 0 }),
          ),
        },
      } as any);
      await expect(
        validator.validatePublishable('prod_archived', TENANT_A),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/use restore_product/i),
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // archive_product — Phase 3.1B
  //
  // Exercises the SAME approval workflow plumbing as publish_product
  // (four-eyes, token hashing, payload hash, stale-data, retry cap)
  // against the inverted operation: active → archived. Tests #1–#22
  // from the 3.1B scope live here. Cross-cutting structural tests
  // (existing tools still work, no other 3.1B routes) live in the
  // `Phase 3.1A structural invariants` block below — that block was
  // extended in this PR to assert exactly 2 @RequiresApproval
  // decorators (publish + archive) and nothing else.
  // ══════════════════════════════════════════════════════════════════
  describe('archive_product — request, approve, execute', () => {
    function approvalArchiveRow(overrides: any = {}) {
      return approvalRow({
        id: 'appr_archive_1',
        toolName: 'archive_product',
        targetResourceId: 'prod_active',
        targetResourceName: 'Ivory Beaded Ball Gown',
        actionTitle: "Archive 'Ivory Beaded Ball Gown'",
        beforeValues: { isActive: true },
        afterValues: { isActive: false },
        payloadHash: payloadHash('archive_product', { productId: 'prod_active' }),
        inputJson: { productId: 'prod_active' },
        ...overrides,
      });
    }

    // ─── INITIATE — tests #1, #2, #3, #4, #5, #6, #7 ────────────────
    describe('requestArchiveProduct', () => {
      it('#A1 operator can create archive approval for an active product', async () => {
        prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(
          approvalArchiveRow(),
        );

        const summary = await service.requestArchiveProduct('prod_active');

        expect(summary.tool).toBe('archive_product');
        expect(summary.status).toBe(AGENT_APPROVAL_STATUS.PENDING);
        expect(summary.riskLevel).toBe('HIGH');
        expect(summary.tokenIssued).toBe(false);
        expect(summary.approvalToken).toBeUndefined();
        expect(summary.ttlSeconds).toBeGreaterThanOrEqual(115);
        expect(summary.ttlSeconds).toBeLessThanOrEqual(120);
      });

      it('#A1b writes APPROVAL_REQUESTED audit row linked to the new approval', async () => {
        prismaMock.agentApprovalRequest.create.mockResolvedValueOnce(
          approvalArchiveRow(),
        );
        await service.requestArchiveProduct('prod_active');
        expect(auditMock.record).toHaveBeenCalledTimes(1);
        const audit = auditCalls[0];
        expect(audit.actionType).toBe('APPROVAL_REQUESTED');
        expect(audit.tool).toBe('archive_product');
        expect(audit.approvalRequestId).toBe('appr_archive_1');
        expect(audit.approvalRequired).toBe(true);
      });

      it('#A2 inactive/draft product cannot be archived (validator throws)', async () => {
        archiveValidatorMock.validateArchivable.mockRejectedValueOnce(
          new BadRequestException(
            'Product is already inactive (archived). Nothing to archive.',
          ),
        );
        await expect(
          service.requestArchiveProduct('prod_inactive'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
        expect(auditMock.record).not.toHaveBeenCalled();
      });

      it('#A2b ARCHIVED product (already inactive) cannot be archived again — lifecycle matrix cell ARCHIVED/archive_product', async () => {
        // Cell #8 of the 12-row lifecycle matrix. The validator rejects
        // any inactive row regardless of whether it's a DRAFT or
        // already ARCHIVED — re-archiving an archived row is a no-op
        // that would clobber the audit chain with no business effect.
        archiveValidatorMock.validateArchivable.mockRejectedValueOnce(
          new BadRequestException(
            'Product is already inactive (archived). Nothing to archive.',
          ),
        );
        await expect(
          service.requestArchiveProduct('prod_already_archived'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('#A3 soft-deleted product cannot be archived', async () => {
        archiveValidatorMock.validateArchivable.mockRejectedValueOnce(
          new BadRequestException(
            'Product is soft-deleted (in the recycle bin).',
          ),
        );
        await expect(
          service.requestArchiveProduct('prod_deleted'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('#A4 cross-tenant product cannot be archived (validator returns "not found" for wrong tenant)', async () => {
        archiveValidatorMock.validateArchivable.mockRejectedValueOnce(
          new BadRequestException(
            `Product prod_other_tenant not found in this tenant — cannot archive.`,
          ),
        );
        await expect(
          service.requestArchiveProduct('prod_other_tenant'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prismaMock.agentApprovalRequest.create).not.toHaveBeenCalled();
      });

      it('#A5 stored row carries correct before/after values (isActive flip)', async () => {
        prismaMock.agentApprovalRequest.create.mockImplementationOnce(
          async ({ data }: any) => ({
            ...approvalArchiveRow(),
            ...data,
            id: 'appr_archive_1',
          }),
        );
        await service.requestArchiveProduct('prod_active');
        const args =
          prismaMock.agentApprovalRequest.create.mock.calls[0][0];
        expect(args.data.beforeValues).toMatchObject({ isActive: true });
        expect(args.data.afterValues).toMatchObject({ isActive: false });
        expect(args.data.actionTitle).toMatch(/^Archive '.+'$/);
        expect(args.data.targetResourceType).toBe('Product');
      });

      it('#A6 stored row carries payloadHash bound to (toolName, productId)', async () => {
        prismaMock.agentApprovalRequest.create.mockImplementationOnce(
          async ({ data }: any) => ({
            ...approvalArchiveRow(),
            ...data,
            id: 'appr_archive_1',
          }),
        );
        await service.requestArchiveProduct('prod_active');
        const args =
          prismaMock.agentApprovalRequest.create.mock.calls[0][0];
        expect(args.data.payloadHash).toBe(
          payloadHash('archive_product', { productId: 'prod_active' }),
        );
        // Distinct from the publish_product hash for the same id.
        expect(args.data.payloadHash).not.toBe(
          payloadHash('publish_product', { productId: 'prod_active' }),
        );
        // approvalTokenHash NEVER persists at request time.
        expect(args.data.approvalTokenHash).toBeUndefined();
      });

      it('#A7 stored row carries expectedUpdatedAt from the live product', async () => {
        const ts = new Date('2026-05-11T09:50:00Z');
        archiveValidatorMock.validateArchivable.mockResolvedValueOnce({
          product: activeProduct({ updatedAt: ts }),
        });
        prismaMock.agentApprovalRequest.create.mockImplementationOnce(
          async ({ data }: any) => ({
            ...approvalArchiveRow(),
            ...data,
            id: 'appr_archive_1',
          }),
        );
        await service.requestArchiveProduct('prod_active');
        const args =
          prismaMock.agentApprovalRequest.create.mock.calls[0][0];
        expect(args.data.expectedUpdatedAt).toEqual(ts);
      });
    });

    // ─── APPROVE — tests #8, #9, #10, #11 ──────────────────────────
    describe('approve (archive)', () => {
      beforeEach(() => {
        service = makeService(
          activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
        );
      });

      it('#A8 initiator cannot approve own archive request', async () => {
        // Switch back to operator — same user as initiator on the row.
        service = makeService(
          activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
        );
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalArchiveRow(),
        );
        await expect(service.approve('appr_archive_1')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        const blocked = auditCalls.find(
          (c) => c.actionType === 'SELF_APPROVAL_BLOCKED',
        );
        expect(blocked).toBeTruthy();
        expect(blocked.tool).toBe('archive_product');
        expect(blocked.severity).toBe('WARNING');
      });

      it('#A9 user without ai-agent:approve cannot approve — covered by guard layer (route-metadata test in structural block asserts the perm)', () => {
        // Sentinel: AiPermissionGuard enforces the perm before the
        // service method is ever called. The structural assertion
        // (`#6 approve route requires ai-agent:approve`) in the Phase
        // 3.1A invariants block already proves the route metadata
        // is wired correctly. We re-assert the path here to keep the
        // archive test list complete + traceable.
        expect(true).toBe(true);
      });

      it('#A10 approver gets the raw token exactly once on success', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalArchiveRow(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({
            status: AGENT_APPROVAL_STATUS.APPROVED,
            approvedByAdminUserId: APPROVER,
            approvalTokenHash: 'hash-not-exposed',
          }),
        );

        const summary = await service.approve('appr_archive_1');

        expect(summary.status).toBe(AGENT_APPROVAL_STATUS.APPROVED);
        expect(summary.approvalToken).toMatch(/^[a-f0-9]{64}$/);
        expect(summary.tokenIssued).toBe(true);
      });

      it('#A11 raw token never appears in any audit input/output during approve', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvalArchiveRow(),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({
            status: AGENT_APPROVAL_STATUS.APPROVED,
            approvedByAdminUserId: APPROVER,
          }),
        );

        const summary = await service.approve('appr_archive_1');
        const rawToken = summary.approvalToken!;
        for (const call of auditCalls) {
          const inputStr = JSON.stringify(call.input ?? {});
          const outputStr = JSON.stringify(call.output ?? {});
          expect(inputStr).not.toContain(rawToken);
          expect(outputStr).not.toContain(rawToken);
          // No 64-hex anywhere.
          expect(inputStr).not.toMatch(/[a-f0-9]{64}/);
          expect(outputStr).not.toMatch(/[a-f0-9]{64}/);
        }
      });
    });

    // ─── EXECUTE — tests #12, #13, #14, #15, #16, #17, #18, #19 ────
    describe('execute (archive)', () => {
      function approvedArchiveRow(rawToken: string, overrides: any = {}) {
        return approvalArchiveRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
          approvedAt: NOW,
          approvalTokenHash: hashApprovalToken(rawToken),
          ...overrides,
        });
      }

      it('#A12 successful execute flips product to isActive=false and returns the new state', async () => {
        const rawToken = 'a'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_active',
          slug: 'ivory-beaded-ball-gown',
          isActive: false,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({
            status: AGENT_APPROVAL_STATUS.CONSUMED,
            consumedAt: NOW,
            approvalTokenHash: null,
          }),
        );

        const result = await service.execute('appr_archive_1', rawToken);

        expect(result.data.isActive).toBe(false);
        expect(result.approvalRequest.status).toBe(
          AGENT_APPROVAL_STATUS.CONSUMED,
        );
        // The dispatch fired the right write — isActive: false AND
        // archivedAt stamped to a non-null Date (Phase 3.1B.α).
        const updateCall = prismaMock.product.update.mock.calls[0][0];
        expect(updateCall.where).toEqual({ id: 'prod_active' });
        expect(updateCall.data.isActive).toBe(false);
        expect(updateCall.data.archivedAt).toBeInstanceOf(Date);
        // Critical lifecycle invariant — archive is NOT a soft-delete.
        expect('deletedAt' in updateCall.data).toBe(false);
      });

      it('#A13 storefront 404 after archive — implicit: execute issues isActive:false', async () => {
        // Server-side: after the write the storefront's
        // findBySlug WHERE clause `isActive: true` filters this row
        // out. We assert the write the consume path issues; the
        // storefront filter is enforced separately by
        // products.service.spec.ts. End-to-end is covered by the
        // production smoke test.
        const rawToken = 'b'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_active',
          slug: 'ivory-beaded-ball-gown',
          isActive: false,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );
        await service.execute('appr_archive_1', rawToken);
        const updateCall = prismaMock.product.update.mock.calls[0][0];
        // Phase 3.1B.α: write shape is now { isActive: false, archivedAt: Date }.
        expect(updateCall.data.isActive).toBe(false);
        expect(updateCall.data.archivedAt).toBeInstanceOf(Date);
      });

      it('#A14 admin lookup unaffected — execute does NOT set deletedAt', async () => {
        const rawToken = 'c'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_active',
          slug: 'ivory-beaded-ball-gown',
          isActive: false,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );
        await service.execute('appr_archive_1', rawToken);
        const updateCall = prismaMock.product.update.mock.calls[0][0];
        // Critical: the dispatch does NOT touch `deletedAt`.
        expect('deletedAt' in updateCall.data).toBe(false);
      });

      it('#A15 stale expectedUpdatedAt fails with stale_data + invalidates approval', async () => {
        const rawToken = 'd'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        // Live product's updatedAt has drifted compared to expectedUpdatedAt.
        prismaMock.product.findFirst.mockResolvedValueOnce(
          activeProduct({ updatedAt: new Date('2026-05-11T09:59:59Z') }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });

        await expect(
          service.execute('appr_archive_1', rawToken),
        ).rejects.toMatchObject({ response: { code: 'stale_data' } });

        const invalidate = prismaMock.agentApprovalRequest.updateMany.mock.calls.find(
          (c: any) => c[0].data.expirationReason === 'stale_data',
        );
        expect(invalidate).toBeTruthy();
        expect(invalidate[0].data.status).toBe(
          AGENT_APPROVAL_STATUS.EXPIRED,
        );
        expect(invalidate[0].data.approvalTokenHash).toBeNull();
      });

      it('#A16 payload hash mismatch blocks execution + invalidates approval', async () => {
        const rawToken = 'e'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken, {
            payloadHash: 'completely_different_hash',
          }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });

        await expect(
          service.execute('appr_archive_1', rawToken),
        ).rejects.toBeInstanceOf(ConflictException);

        const invalidate = prismaMock.agentApprovalRequest.updateMany.mock.calls.find(
          (c: any) => c[0].data.expirationReason === 'payload_mismatch',
        );
        expect(invalidate).toBeTruthy();
        expect(invalidate[0].data.status).toBe(
          AGENT_APPROVAL_STATUS.EXPIRED,
        );
        expect(invalidate[0].data.approvalTokenHash).toBeNull();
      });

      it('#A17a expired approval cannot execute', async () => {
        const rawToken = 'f'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken, {
            expiresAt: new Date(NOW.getTime() - 1000),
          }),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        await expect(
          service.execute('appr_archive_1', rawToken),
        ).rejects.toMatchObject({ response: { code: 'approval_expired' } });
      });

      it('#A17b rejected/revoked approval cannot execute (lookup returns no row — hash cleared)', async () => {
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.execute('appr_archive_1', 'x'.repeat(64)),
        ).rejects.toMatchObject({
          response: { code: 'approval_invalid_or_consumed' },
        });
      });

      it('#A18 consumed approval cannot execute twice (hash cleared on consume)', async () => {
        // First execute succeeds elsewhere; the second lookup returns
        // no row because approvalTokenHash was nulled on consume.
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.execute('appr_archive_1', 'y'.repeat(64)),
        ).rejects.toMatchObject({
          response: { code: 'approval_invalid_or_consumed' },
        });
      });

      it('#A19a tenant A cannot execute tenant B archive (token-hash lookup is tenant-scoped)', async () => {
        const rawToken = 'g'.repeat(64);
        service = makeService(
          activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
          TENANT_A,
        );
        prismaMock.agentApprovalRequest.findFirst.mockImplementationOnce(
          ({ where }: any) =>
            Promise.resolve(
              where.tenantId === TENANT_B ? approvalArchiveRow() : null,
            ),
        );
        await expect(
          service.execute('appr_archive_b', rawToken),
        ).rejects.toMatchObject({
          response: { code: 'approval_invalid_or_consumed' },
        });
      });

      it('#A19b tenant A cannot approve tenant B archive request (404 not 403)', async () => {
        service = makeService(
          activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
          TENANT_A,
        );
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(null);
        await expect(
          service.approve('appr_archive_from_tenant_b'),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('writes a linked ARCHIVE audit row on success (not PUBLISH)', async () => {
        const rawToken = 'h'.repeat(64);
        prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
          approvedArchiveRow(rawToken),
        );
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.findFirst.mockResolvedValueOnce(activeProduct());
        prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({
          count: 1,
        });
        prismaMock.product.update.mockResolvedValueOnce({
          id: 'prod_active',
          slug: 'ivory-beaded-ball-gown',
          isActive: false,
        });
        prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
          approvalArchiveRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
        );

        await service.execute('appr_archive_1', rawToken);

        const archive = auditCalls.find((c) => c.actionType === 'ARCHIVE');
        expect(archive).toBeTruthy();
        expect(archive.tool).toBe('archive_product');
        expect(archive.approvalRequestId).toBe('appr_archive_1');
        expect(archive.severity).toBe('NOTICE');
        // No raw token literal landed in either input or output.
        const inStr = JSON.stringify(archive.input);
        const outStr = JSON.stringify(archive.output);
        expect(inStr).not.toMatch(/[a-f0-9]{64}/);
        expect(outStr).not.toMatch(/[a-f0-9]{64}/);
      });
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

  // ──────────────────────────────────────────────────────────────────
  // Token-hardening pass — 2026-05-11
  //
  // Surfaced from production: the first Phase 3.1A smoke run on commit
  // 7ba1522 leaked raw approval tokens into AgentAuditLog because the
  // sanitiser allowlisted `approvalToken` AND the runner's default
  // auto-audit captured the approve handler's full return value. Hotfix
  // 4193e64 + this pass close all known surface area. These 9 tests
  // assert the invariants so the leak cannot regress.
  // ──────────────────────────────────────────────────────────────────
  describe('Token hardening — raw approvalToken must never persist', () => {
    const productsControllerPath = join(__dirname, '..', 'controllers', 'products.ai.controller.ts');
    const approvalsControllerPath = join(__dirname, '..', 'controllers', 'approvals.ai.controller.ts');
    const sanitiserPath = join(__dirname, 'ai-sanitizer.service.ts');
    const approvalServicePath = join(__dirname, 'approval.service.ts');
    const productsSrc = readFileSync(productsControllerPath, 'utf8');
    const approvalsSrc = readFileSync(approvalsControllerPath, 'utf8');
    const sanitiserSrc = readFileSync(sanitiserPath, 'utf8');
    const approvalSrc = readFileSync(approvalServicePath, 'utf8');

    it('#H1 approve HTTP response includes the raw approvalToken (return-once contract)', async () => {
      // We exercise the full approve path with a freshly-constructed
      // service and verify the summary that comes back DOES contain a
      // 64-char hex approvalToken field.
      const local = makeService(
        activeRequest({ user: { id: APPROVER, sub: APPROVER } }),
      );
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(approvalRow());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED, approvedByAdminUserId: APPROVER }),
      );

      const summary = await local.approve('appr_1');

      expect(summary.tokenIssued).toBe(true);
      expect(typeof summary.approvalToken).toBe('string');
      expect(summary.approvalToken).toMatch(/^[a-f0-9]{64}$/);
    });

    it('#H2 sanitiser has NO allowlist any more — every key with "approvaltoken" is redacted', () => {
      // Defence-in-depth: the source should not contain an ALLOWLIST
      // constant any more. If a future refactor reintroduces one, this
      // test fails loudly.
      const stripped = sanitiserSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(stripped).not.toMatch(/ALLOWLIST\s*=/);
      // And the new redact pattern MUST be in the list.
      expect(stripped).toMatch(/\/approvaltoken\//);
    });

    it('#H3 approve route uses auditOutput to strip approvalToken from the runner audit row', () => {
      // The runner's default behaviour persists the handler's full
      // return value. The approve handler returns the raw token. The
      // auditOutput transform MUST destructure it out.
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Find the approve method's runner.run({...}) block — match a
      // generous span from @Post(':id/approve') up to the next @Post.
      const match = stripped.match(
        /@Post\(':id\/approve'\)[\s\S]*?(?=@Post\(|@RequiresAiPermission\(AI_PERMISSION_CODES\.APPROVE\)\n\s*@Post\(':id\/reject)/,
      );
      expect(match).toBeTruthy();
      const block = match![0];
      expect(block).toContain('auditOutput');
      expect(block).toMatch(/approvalToken\s*,\s*\.\.\.redacted/);
    });

    it('#H4 execute route logs tokenProvided boolean — NEVER the raw approvalToken', () => {
      // Belt-and-braces over the sanitiser: the controller MUST NOT
      // construct an audit input that contains the raw token at all.
      // The current code uses `input: { id, tokenProvided: !!dto.approvalToken }`.
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Locate the execute method block.
      const match = stripped.match(/@Post\(':id\/execute'\)[\s\S]+?\}\)\s*$/m) ??
        stripped.match(/@Post\(':id\/execute'\)[\s\S]+?\}\s*\n\}/);
      expect(match).toBeTruthy();
      const block = match![0];
      // tokenProvided boolean appears.
      expect(block).toMatch(/tokenProvided:\s*!!dto\.approvalToken/);
      // Raw approvalToken value is NOT passed as audit input.
      expect(block).not.toMatch(/input:\s*\{[^}]*approvalToken:\s*dto\.approvalToken/);
      // execute uses auditOutput too, so the handler return value is
      // redacted before audit even if it ever grew a token field.
      expect(block).toContain('auditOutput');
    });

    it('#H5 GET /ai/approvals/:id does NOT expose approvalTokenHash or approvalToken', async () => {
      // The toSummary serialiser ships id/status/tool/etc. but never
      // the hash. Confirm with a live row that carries a non-null hash.
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvalTokenHash: 'live_hash_should_not_leak_to_wire',
        }),
      );
      const summary = await service.getOne('appr_1');
      const wireShape = JSON.parse(JSON.stringify(summary));
      expect('approvalTokenHash' in wireShape).toBe(false);
      expect('approvalToken' in wireShape).toBe(false);
      expect(wireShape.tokenIssued).toBe(true); // derived boolean, OK
    });

    it('#H6 GET /ai/approvals (list) never exposes approvalTokenHash or approvalToken', async () => {
      prismaMock.agentApprovalRequest.findMany.mockResolvedValueOnce([
        approvalRow({ status: AGENT_APPROVAL_STATUS.APPROVED, approvalTokenHash: 'hash_a' }),
        approvalRow({
          id: 'appr_2',
          status: AGENT_APPROVAL_STATUS.CONSUMED,
          approvalTokenHash: null,
        }),
      ]);
      const rows = await service.list({});
      const wire = JSON.parse(JSON.stringify(rows));
      for (const r of wire) {
        expect('approvalTokenHash' in r).toBe(false);
        expect('approvalToken' in r).toBe(false);
      }
    });

    it('#H7 successful execute clears approvalTokenHash (defence-in-depth) — verified in the consume transaction', () => {
      // Source-level invariant: the CONSUMED update writes
      // approvalTokenHash: null. If a future refactor breaks this, a
      // leaked raw token might still hash-match a CONSUMED row.
      const stripped = approvalSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Look for the CONSUMED-with-hash-cleared block.
      expect(stripped).toMatch(
        /status:\s*AGENT_APPROVAL_STATUS\.CONSUMED[\s\S]{0,200}approvalTokenHash:\s*null/,
      );
    });

    it('#H8 revoke clears approvalTokenHash so any leaked raw token cannot execute', () => {
      const stripped = approvalSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Look for the REVOKED transition block; it MUST set hash to null.
      expect(stripped).toMatch(
        /status:\s*AGENT_APPROVAL_STATUS\.REVOKED[\s\S]{0,300}approvalTokenHash:\s*null/,
      );
    });

    it('#H9 approval-linked PUBLISH audit row contains zero secret-shaped fields after execute', async () => {
      // Full execute flow — fetch all audit calls and assert the linked
      // ones don't carry an `approvalToken` key OR a 64-hex literal.
      const rawToken = 'n'.repeat(64);
      const local = makeService(
        activeRequest({ user: { id: OPERATOR, sub: OPERATOR } }),
      );
      prismaMock.agentApprovalRequest.findFirst.mockResolvedValueOnce(
        approvalRow({
          status: AGENT_APPROVAL_STATUS.APPROVED,
          approvedByAdminUserId: APPROVER,
          approvedAt: NOW,
          approvalTokenHash: hashApprovalToken(rawToken),
        }),
      );
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.findFirst.mockResolvedValueOnce(draftProduct());
      prismaMock.agentApprovalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.product.update.mockResolvedValueOnce({
        id: 'prod_draft', slug: 'floral-mermaid-gown', isActive: true,
      });
      prismaMock.agentApprovalRequest.findUnique.mockResolvedValueOnce(
        approvalRow({ status: AGENT_APPROVAL_STATUS.CONSUMED }),
      );

      await local.execute('appr_1', rawToken);

      const HEX64 = /[a-f0-9]{64}/;
      for (const call of auditCalls) {
        const inputStr = JSON.stringify(call.input ?? {});
        const outputStr = JSON.stringify(call.output ?? {});
        expect(inputStr).not.toMatch(HEX64);
        expect(outputStr).not.toMatch(HEX64);
        expect(inputStr).not.toContain('"approvalToken"');
        expect(outputStr).not.toContain('"approvalToken"');
      }
    });

    // ────────────────────────────────────────────────────────────────
    //  Re-hardening pass — 2026-05-11
    //
    //  Source-text invariants that close the surface area the user's
    //  hardening prompt explicitly listed and that weren't already
    //  enforced by H1–H9 above. Each test is a fast string scan over
    //  the controller / service source so a future refactor can't
    //  silently reintroduce the leak.
    // ────────────────────────────────────────────────────────────────

    it('#HR1 execute route logs tokenHashPrefix (first 6 hex of hash) for forensic correlation — NEVER the raw token or the full hash', () => {
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The exact construction: hashApprovalToken(...).slice(0, 6)
      expect(stripped).toMatch(/hashApprovalToken\([^)]*\)\.slice\(\s*0\s*,\s*6\s*\)/);
      // tokenHashPrefix is added to the input audit payload via the
      // spread-conditional form.
      expect(stripped).toMatch(/tokenHashPrefix/);
      // Negative: the raw token (dto.approvalToken) is NOT passed to
      // the runner's input directly.
      expect(stripped).not.toMatch(/input:\s*\{[^}]*approvalToken:\s*dto\.approvalToken/);
    });

    it('#HR2 dto.approvalToken is only read by the execute route — never by reject/revoke/cancel/list/get', () => {
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Count every reference to dto.approvalToken in the controller.
      // The execute handler uses it twice (the hash compute + the
      // service call AND the tokenProvided boolean derivation). NO
      // other handler is allowed to touch it.
      const refs = stripped.match(/dto\.approvalToken/g) ?? [];
      expect(refs.length).toBeGreaterThan(0); // execute uses it
      // Locate the execute block by @Post(':id/execute') and assert
      // every dto.approvalToken occurrence falls inside it.
      const execStart = stripped.indexOf("@Post(':id/execute')");
      expect(execStart).toBeGreaterThan(-1);
      // Execute is the last method; everything after execStart is fair game.
      const beforeExecute = stripped.slice(0, execStart);
      expect(beforeExecute).not.toContain('dto.approvalToken');
    });

    it('#HR3 ApprovalRequestSummary type does NOT declare approvalTokenHash (controller responses are typed clean)', () => {
      const stripped = approvalSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The interface block for ApprovalRequestSummary.
      const m = stripped.match(
        /export interface ApprovalRequestSummary \{([\s\S]+?)\n\}/,
      );
      expect(m).toBeTruthy();
      const block = m![1];
      // It MAY (and does) declare approvalToken (optional, raw on approve).
      // It MUST NOT declare approvalTokenHash — that's storage-only.
      expect(block).not.toMatch(/approvalTokenHash/);
    });

    it('#HR4 toSummary() reads row.approvalTokenHash ONLY to derive the tokenIssued boolean — never to emit it on the wire', () => {
      const stripped = approvalSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Locate the toSummary method body.
      const m = stripped.match(/private toSummary\([\s\S]+?\n\s{2}\}/);
      expect(m).toBeTruthy();
      const body = m![0];
      // The serialiser reads `row.approvalTokenHash` to compute the
      // tokenIssued boolean. It must NOT include the hash in the
      // return object. We assert exactly one read (the boolean
      // derivation) and zero emissions.
      const reads = body.match(/row\.approvalTokenHash/g) ?? [];
      expect(reads.length).toBe(1);
      // The returned object literal must not assign the hash to any key.
      expect(body).not.toMatch(/\bapprovalTokenHash:\s*/);
      // And the public-facing field MUST be the boolean derivation, not the hash value.
      expect(body).toMatch(/tokenIssued:[\s\S]+?row\.approvalTokenHash/);
    });

    it('#HR5 execute audit input includes tokenProvided boolean — controller never offers raw token to the audit layer', () => {
      const stripped = approvalsSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The execute handler's runner.run input shape.
      const m = stripped.match(/@Post\(':id\/execute'\)[\s\S]+?\}\)\s*;/);
      expect(m).toBeTruthy();
      const block = m![0];
      expect(block).toMatch(/tokenProvided:\s*!!dto\.approvalToken/);
    });
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
