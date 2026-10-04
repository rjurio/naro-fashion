import { NotFoundException } from '@nestjs/common';

/**
 * Foreign-id tenant validation helpers.
 *
 * Route guards (AdminGuard etc.) prove WHO is calling; they do not prove that
 * a client-supplied foreign key (`categoryId`, `parentId`, `sizeGuideId`,
 * `productIds[]`, `shippingZoneId`, ...) points at a row in the caller's own
 * tenant. Without this check an admin of tenant A can link their rows to
 * tenant B's category / size guide / product, and the relation include then
 * leaks tenant B's data back through tenant A's responses.
 *
 * Every helper returns 404 (not 403) so a cross-tenant probe can't tell
 * "exists in another tenant" apart from "doesn't exist".
 */

/** Minimal shape of a Prisma model delegate we need (findFirst / count). */
export interface TenantScopedDelegate {
  findFirst(args: any): Promise<any>;
  count(args: any): Promise<number>;
}

/**
 * Assert a single id belongs to `tenantId`. `extraWhere` lets callers add
 * e.g. `{ deletedAt: null }`. No-op when `id` is null/undefined/empty so
 * callers can pass optional DTO fields straight through.
 */
export async function assertSameTenant(
  delegate: TenantScopedDelegate,
  id: string | null | undefined,
  tenantId: string,
  label: string,
  extraWhere: Record<string, unknown> = {},
): Promise<void> {
  if (!id) return;
  const row = await delegate.findFirst({
    where: { id, tenantId, ...extraWhere },
    select: { id: true },
  });
  if (!row) throw new NotFoundException(`${label} not found`);
}

/**
 * Assert EVERY id in `ids` belongs to `tenantId` (duplicates tolerated).
 * One COUNT query regardless of list size.
 */
export async function assertAllSameTenant(
  delegate: TenantScopedDelegate,
  ids: string[] | null | undefined,
  tenantId: string,
  label: string,
  extraWhere: Record<string, unknown> = {},
): Promise<void> {
  if (!ids || ids.length === 0) return;
  const unique = Array.from(new Set(ids));
  const found = await delegate.count({
    where: { id: { in: unique }, tenantId, ...extraWhere },
  });
  if (found !== unique.length) {
    throw new NotFoundException(`One or more ${label} not found`);
  }
}
