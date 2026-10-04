/**
 * Hand-maintained allowlist of tenant-scoped Prisma calls that are
 * intentionally NOT filtered by tenantId even inside a tenant HTTP request.
 *
 * Models without a `tenantId` column (Tenant, PlatformAdmin, Permission,
 * RolePermission, SubscriptionPlan, ...) are skipped automatically and never
 * need an entry here. Platform-admin requests, crons, seeders and scripts are
 * skipped wholesale (no tenant request context).
 *
 * Rules:
 *  - Every entry MUST carry a one-line reason.
 *  - Prefer a `callSite` pattern over a bare model/operation entry so the
 *    exemption doesn't silently cover new code elsewhere.
 *  - Cross-tenant MISMATCHES (explicit tenantId ≠ request tenant) are only
 *    exempted by entries with `allowCrossTenant: true` (public data only).
 *  - The right fix for a new warning is almost always to add `tenantId` to
 *    the where-clause, not an entry here.
 */
export interface TenantScopeAllowEntry {
  model: string;
  /** Prisma operation names, or '*' for all. */
  operations: ReadonlyArray<string> | '*';
  /** Optional regex tested against the normalised call-site (`src/auth/auth.service.ts:267`). */
  callSite?: RegExp;
  /**
   * Also exempts an explicit tenantId that differs from the request tenant.
   * Only for public reads of public data keyed by a caller-supplied tenant id.
   */
  allowCrossTenant?: boolean;
  reason: string;
}

export const TENANT_SCOPE_ALLOWLIST: ReadonlyArray<TenantScopeAllowEntry> = [
  {
    model: 'AdminUser',
    operations: ['findUnique', 'findUniqueOrThrow', 'findFirst', 'update', 'updateMany'],
    callSite: /(^|\/)auth\/(auth\.service|strategies\/)/,
    reason:
      'AdminUser.email is globally unique; login / forgot-password / token-version checks resolve the admin by email or by the verified JWT `sub` before the tenant is known.',
  },
  {
    model: 'User',
    operations: ['findUnique', 'findUniqueOrThrow', 'update', 'updateMany'],
    callSite: /(^|\/)auth\/(auth\.service|strategies\/)/,
    reason: 'Principal is resolved by the verified JWT `sub` (signed token is the scope) in refresh / logout / token-version flows.',
  },
  {
    model: 'LoginAttempt',
    operations: '*',
    callSite: /(^|\/)auth\//,
    reason: 'Lockout bookkeeping is keyed by email and written during login, before tenant resolution.',
  },
  {
    model: 'NewsletterSubscriber',
    operations: ['findFirst', 'findUnique', 'update'],
    callSite: /(^|\/)newsletter\/newsletter\.service/,
    reason:
      'Public unsubscribe resolves the subscriber by the globally-unique unsubscribeToken (the token is the auth); the email link carries no tenant.',
  },
  {
    model: 'TenantBranding',
    operations: ['findUnique'],
    callSite: /(^|\/)tenants\/tenants\.service/,
    allowCrossTenant: true,
    reason:
      'Public GET /tenants/:id/branding takes the tenant id from the path; a storefront with a stale tenant cookie may legitimately ask for another tenant\'s (public) branding.',
  },
];

export function findAllowEntry(
  model: string,
  operation: string,
  callSite: string | null,
  opts: { crossTenant?: boolean } = {},
): TenantScopeAllowEntry | undefined {
  for (const entry of TENANT_SCOPE_ALLOWLIST) {
    if (entry.model !== model) continue;
    if (opts.crossTenant && !entry.allowCrossTenant) continue;
    if (entry.operations !== '*' && !entry.operations.includes(operation)) continue;
    if (entry.callSite && !(callSite && entry.callSite.test(callSite))) continue;
    return entry;
  }
  return undefined;
}

/** True when some entry for model/op could match without needing a call-site (no stack capture needed). */
export function hasCallSiteFreeEntry(model: string, operation: string): boolean {
  return TENANT_SCOPE_ALLOWLIST.some(
    (e) => e.model === model && !e.callSite && (e.operations === '*' || e.operations.includes(operation)),
  );
}
