import { createHash, randomBytes } from 'crypto';

/**
 * Approval-token helpers — Phase 3.1 (see PHASE_3_DESIGN.md §5).
 *
 * The raw token leaves this module exactly once: it's returned to the
 * approver in the HTTP response. The database NEVER sees the raw value —
 * only `sha256(rawToken)` is persisted on `AgentApprovalRequest.approvalTokenHash`.
 * Same pattern as `AdminUser.passwordResetToken`.
 *
 * 32 random bytes → 64 hex chars → ~256 bits of entropy. Brute-forcing
 * within the configured TTL (60s..10min) is not feasible.
 */

/**
 * Generate a fresh raw token + its sha256 hash. The raw value is what we
 * return to the approver; the hash is what we store.
 */
export function generateApprovalToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashApprovalToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Recompute the hash of a candidate raw token for the consume-time
 * `WHERE approvalTokenHash = ?` lookup.
 */
export function hashApprovalToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
