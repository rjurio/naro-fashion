/**
 * AgentApprovalRequest status + risk-level constants (Phase 3.0+).
 *
 * Mirror what the Prisma schema's String fields accept. The seeder, guard,
 * and (future) approval service all import from here.
 */

export const AGENT_APPROVAL_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  REVOKED: 'REVOKED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  EXHAUSTED: 'EXHAUSTED',
} as const;

export type AgentApprovalStatus =
  (typeof AGENT_APPROVAL_STATUS)[keyof typeof AGENT_APPROVAL_STATUS];

/**
 * Terminal states — no further transitions allowed once a request lands here.
 */
export const TERMINAL_AGENT_APPROVAL_STATUSES: ReadonlyArray<AgentApprovalStatus> =
  [
    AGENT_APPROVAL_STATUS.REJECTED,
    AGENT_APPROVAL_STATUS.CANCELLED,
    AGENT_APPROVAL_STATUS.REVOKED,
    AGENT_APPROVAL_STATUS.CONSUMED,
    AGENT_APPROVAL_STATUS.EXPIRED,
    AGENT_APPROVAL_STATUS.EXHAUSTED,
  ];

/**
 * Risk level — drives token TTL, approver-UI warning intensity, and (Phase 4)
 * multi-approver count. See PHASE_3_DESIGN.md §5 + Decision Log #8.
 */
export const AI_RISK_LEVEL = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type AiRiskLevel = (typeof AI_RISK_LEVEL)[keyof typeof AI_RISK_LEVEL];

/**
 * Token TTL by risk level (milliseconds).
 * Used by Phase 3.1 — Phase 3.0 only ships the constants.
 */
export const AI_RISK_LEVEL_TTL_MS: Record<AiRiskLevel, number> = {
  LOW: 10 * 60 * 1000, // 10 min
  MEDIUM: 5 * 60 * 1000, // 5 min
  HIGH: 2 * 60 * 1000, // 2 min
  CRITICAL: 60 * 1000, // 60 sec
};

export const MAX_APPROVAL_EXECUTION_ATTEMPTS = 3;
