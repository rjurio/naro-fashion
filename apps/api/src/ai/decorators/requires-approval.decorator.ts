import { SetMetadata } from '@nestjs/common';
import { AiRiskLevel, AI_RISK_LEVEL } from '../types/agent-approval.types';

/**
 * Reflector key — read by the (future) ApprovalTokenInterceptor in Phase 3.1.
 *
 * Phase 3.0 ships the decorator + the metadata key only. There is NO runtime
 * enforcement yet — applying this decorator to a route in Phase 3.0 has zero
 * effect at request time. The interceptor lands with Phase 3.1 alongside the
 * approval-management routes.
 */
export const REQUIRES_APPROVAL_KEY = 'requiresApproval';

export interface RequiresApprovalMetadata {
  riskLevel: AiRiskLevel;
}

/**
 * Mark a route as requiring an approval workflow before the underlying
 * action runs. Phase 3.1 will wire this to a two-phase commit:
 *
 *   POST without approvalToken → handler returns approval_required envelope
 *   POST with valid approvalToken → handler executes the action
 *
 * Risk level drives token TTL and (Phase 4) multi-approver count. See
 * docs/ai-agent/PHASE_3_DESIGN.md §5 for the full table.
 *
 * Phase 3.0 — placeholder only. No risky tools are wired yet.
 */
export const RequiresApproval = (riskLevel: AiRiskLevel) =>
  SetMetadata(REQUIRES_APPROVAL_KEY, { riskLevel } satisfies RequiresApprovalMetadata);

// Re-export risk levels so route files can write
//   @RequiresApproval(AI_RISK_LEVEL.HIGH)
// without a second import.
export { AI_RISK_LEVEL };
