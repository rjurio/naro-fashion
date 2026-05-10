import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  AI_PERMISSION_CODES,
  AI_AGENT_ROLE_NAMES,
} from './types/ai-permissions.types';
import { AGENT_APPROVAL_STATUS, AI_RISK_LEVEL } from './types/agent-approval.types';

/**
 * Phase 3.0 foundation invariants — schema, permission seed, and
 * "no risky tools yet" structural checks. These run as plain Jest unit
 * tests against the source on disk; no NestJS app boot, no DB.
 *
 * The point of this file is to fail the build the moment any of the
 * Phase 3.0 contracts are accidentally weakened by a future PR — for
 * example, if someone adds a raw `approvalToken` field, ships a risky
 * controller before Phase 3.1 is approved, or removes one of the four
 * AI permission codes from the seed.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCHEMA_PATH = join(
  REPO_ROOT,
  'packages',
  'database',
  'prisma',
  'schema.prisma',
);
const PERMISSIONS_SERVICE_PATH = join(
  __dirname,
  '..',
  'permissions',
  'permissions.service.ts',
);
const AI_CONTROLLERS_DIR = join(__dirname, 'controllers');

const schemaSrc = readFileSync(SCHEMA_PATH, 'utf8');
const permissionsServiceSrc = readFileSync(PERMISSIONS_SERVICE_PATH, 'utf8');

function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'm');
  const match = schemaSrc.match(re);
  if (!match) throw new Error(`model ${name} not found in schema.prisma`);
  return match[0];
}

describe('Phase 3.0 foundation invariants', () => {
  // ─────────────────────────────────────────────────────────────────────
  // A. Schema — AgentApprovalRequest exists with the right shape
  // ─────────────────────────────────────────────────────────────────────
  describe('AgentApprovalRequest schema', () => {
    it('model exists in schema.prisma', () => {
      expect(() => modelBlock('AgentApprovalRequest')).not.toThrow();
    });

    it('declares every field required by PHASE_3_DESIGN.md', () => {
      const block = modelBlock('AgentApprovalRequest');
      const requiredFields = [
        'id',
        'tenantId',
        'requestedByAdminUserId',
        'approvedByAdminUserId',
        'actionTitle',
        'businessSummary',
        'targetResourceType',
        'targetResourceId',
        'targetResourceName',
        'toolName',
        'riskLevel',
        'status',
        'approvalTokenHash',
        'payloadHash',
        'expectedUpdatedAt',
        'beforeValues',
        'afterValues',
        'inputJson',
        'expiresAt',
        'approvedAt',
        'consumedAt',
        'revokedAt',
        'rejectedAt',
        'cancelledAt',
        'executionAttempts',
        'createdAt',
        'updatedAt',
      ];
      for (const field of requiredFields) {
        // Anchor on whitespace before the field name so we don't match
        // substrings (e.g. "id" inside "approvalRequestId").
        expect(block).toMatch(new RegExp(`\\n\\s+${field}\\s+`));
      }
    });

    it('is tenant-scoped (tenantId field + composite index)', () => {
      const block = modelBlock('AgentApprovalRequest');
      expect(block).toMatch(/\n\s+tenantId\s+String\?/);
      expect(block).toMatch(/@@index\(\[tenantId,\s*status\]\)/);
    });

    it('stores ONLY the hashed token — never a raw approvalToken', () => {
      const block = modelBlock('AgentApprovalRequest');
      // approvalTokenHash MUST exist, nullable, with @unique
      expect(block).toMatch(/approvalTokenHash\s+String\?\s+@unique/);
      // a bare `approvalToken String...` field would defeat the purpose;
      // the only thing that should reference "approvalToken" is the hash field.
      const rawTokenField = /\n\s+approvalToken\s+String/;
      expect(block).not.toMatch(rawTokenField);
    });

    it('has the relations needed for four-eyes (requestedBy + approvedBy)', () => {
      const block = modelBlock('AgentApprovalRequest');
      expect(block).toMatch(/AgentApprovalRequestedBy/);
      expect(block).toMatch(/AgentApprovalApprovedBy/);
    });

    it('AdminUser has the matching back-relations', () => {
      const adminUser = modelBlock('AdminUser');
      expect(adminUser).toMatch(/agentApprovalsRequested/);
      expect(adminUser).toMatch(/agentApprovalsApproved/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // B. Schema — AgentAuditLog can link to AgentApprovalRequest
  // ─────────────────────────────────────────────────────────────────────
  describe('AgentAuditLog ↔ AgentApprovalRequest linkage', () => {
    it('AgentAuditLog has approvalRequestId column', () => {
      const block = modelBlock('AgentAuditLog');
      expect(block).toMatch(/\n\s+approvalRequestId\s+String\?/);
    });

    it('AgentAuditLog has the approvalRequest relation pointing at AgentApprovalRequest', () => {
      const block = modelBlock('AgentAuditLog');
      expect(block).toMatch(
        /approvalRequest\s+AgentApprovalRequest\?\s+@relation/,
      );
    });

    it('AgentAuditLog indexes approvalRequestId for fast joins', () => {
      const block = modelBlock('AgentAuditLog');
      expect(block).toMatch(/@@index\(\[approvalRequestId\]\)/);
    });

    it('AgentApprovalRequest reverses the relation via auditLogs', () => {
      const block = modelBlock('AgentApprovalRequest');
      expect(block).toMatch(/auditLogs\s+AgentAuditLog\[\]/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // C. Permissions seed — the 4 AI permission codes are present
  // ─────────────────────────────────────────────────────────────────────
  describe('Permission seed (permissions.service.ts)', () => {
    it.each(Object.values(AI_PERMISSION_CODES))(
      'permission %s is in the seed list',
      (code) => {
        expect(permissionsServiceSrc).toContain(`'${code}'`);
      },
    );

    it('keeps the existing ai-agent:use permission (back-compat)', () => {
      expect(permissionsServiceSrc).toContain("'ai-agent:use'");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // D. Type contracts — risk levels + statuses are exhaustive
  // ─────────────────────────────────────────────────────────────────────
  describe('Type contracts', () => {
    it('exposes the four AI permission codes as constants', () => {
      expect(AI_PERMISSION_CODES.USE).toBe('ai-agent:use');
      expect(AI_PERMISSION_CODES.READ).toBe('ai-agent:read');
      expect(AI_PERMISSION_CODES.WRITE_DRAFTS).toBe('ai-agent:write-drafts');
      expect(AI_PERMISSION_CODES.APPROVE).toBe('ai-agent:approve');
    });

    it('exposes the two seeded role names', () => {
      expect(AI_AGENT_ROLE_NAMES.OPERATOR).toBe('AI_AGENT_OPERATOR');
      expect(AI_AGENT_ROLE_NAMES.APPROVER).toBe('AI_AGENT_APPROVER');
    });

    it('declares all 8 approval statuses (incl. REVOKED + EXHAUSTED)', () => {
      const expected = [
        'PENDING',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'REVOKED',
        'CONSUMED',
        'EXPIRED',
        'EXHAUSTED',
      ];
      for (const s of expected) {
        expect(Object.values(AGENT_APPROVAL_STATUS)).toContain(s);
      }
    });

    it('declares the four risk levels', () => {
      const expected = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      for (const r of expected) {
        expect(Object.values(AI_RISK_LEVEL)).toContain(r);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // E. No risky AI tools are exposed yet
  // ─────────────────────────────────────────────────────────────────────
  describe('No Phase 3 risky tools wired', () => {
    const RISKY_PATH_FRAGMENTS = [
      "'publish'",
      "'archive'",
      "'permanent-delete'",
      "'/permanent-delete'",
      "':id/publish'",
      "':id/archive'",
      "'/refund'",
      "'/refunds'",
      "'/status'",
      "'inventory/adjust'",
    ];

    const controllerFiles = readdirSync(AI_CONTROLLERS_DIR).filter(
      (f) => f.endsWith('.ai.controller.ts') && !f.endsWith('.spec.ts'),
    );

    it.each(controllerFiles)(
      'controller %s does NOT declare any risky-action route paths',
      (file) => {
        const src = readFileSync(join(AI_CONTROLLERS_DIR, file), 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        for (const fragment of RISKY_PATH_FRAGMENTS) {
          expect(stripped).not.toContain(fragment);
        }
      },
    );

    it('@RequiresApproval decorator is NOT applied to any route yet', () => {
      // Phase 3.0 ships the decorator + metadata key only. No route uses it
      // until Phase 3.1 lands. If a future PR applies the decorator, it
      // means a risky tool was wired — that's a Phase 3.1 change and must
      // not slip into a Phase 3.0 PR.
      for (const file of controllerFiles) {
        const src = readFileSync(join(AI_CONTROLLERS_DIR, file), 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        expect(stripped).not.toContain('@RequiresApproval(');
      }
    });

    it('@RequiresAiPermission decorator is NOT applied to any route yet (Phase 3.0 ships scaffold only)', () => {
      // Same back-compat hinge: as long as no Phase 1/2 controller carries
      // @RequiresAiPermission(), the AiPermissionGuard's optional-scope
      // path stays inactive on those routes — confirming "no behaviour
      // change for existing endpoints".
      for (const file of controllerFiles) {
        const src = readFileSync(join(AI_CONTROLLERS_DIR, file), 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        expect(stripped).not.toContain('@RequiresAiPermission(');
      }
    });
  });
});
