/**
 * AI agent permission codes (Phase 3.0+).
 *
 * Defined as a const-as-record so we get both compile-time exhaustiveness
 * via the `AiPermissionCode` type AND runtime iteration for seeders/tests.
 *
 * The codebase doesn't use Prisma enums — see existing string-status
 * patterns on Order, RentalOrder, Payment, etc. We follow the same
 * convention here: the database column is a String, the allowed values
 * are this TypeScript constant.
 */
export const AI_PERMISSION_CODES = {
  USE: 'ai-agent:use',
  READ: 'ai-agent:read',
  WRITE_DRAFTS: 'ai-agent:write-drafts',
  APPROVE: 'ai-agent:approve',
} as const;

export type AiPermissionCode =
  (typeof AI_PERMISSION_CODES)[keyof typeof AI_PERMISSION_CODES];

export const AI_SCOPE_PERMISSION_CODES = [
  AI_PERMISSION_CODES.READ,
  AI_PERMISSION_CODES.WRITE_DRAFTS,
  AI_PERMISSION_CODES.APPROVE,
] as const;

export type AiScopePermissionCode = (typeof AI_SCOPE_PERMISSION_CODES)[number];

export const AI_AGENT_ROLE_NAMES = {
  OPERATOR: 'AI_AGENT_OPERATOR',
  APPROVER: 'AI_AGENT_APPROVER',
} as const;

export type AiAgentRoleName =
  (typeof AI_AGENT_ROLE_NAMES)[keyof typeof AI_AGENT_ROLE_NAMES];
