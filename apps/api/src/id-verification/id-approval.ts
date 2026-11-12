/**
 * The ONE National ID check shared by bookings (RentalsService), rental
 * status changes, payment settlement and ID review. Owner rule 2026-11-12:
 * one APPROVED CustomerIDDocument per customer account (per tenant), with no
 * expiry, reused for later bookings until it is no longer APPROVED.
 *
 * Always read the document — never trust a rental's status as proof of ID.
 */

/** Minimal shape of a Prisma client or transaction client used here. */
export interface IdDocReader {
  customerIDDocument: { findFirst(args: any): Promise<unknown> };
}

export async function hasApprovedId(
  db: IdDocReader,
  tenantId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const doc = await db.customerIDDocument.findFirst({
    where: { tenantId, userId, verificationStatus: 'APPROVED' },
    select: { id: true },
  });
  return !!doc;
}

/** Minimal shape of a Prisma transaction client used for the lock. */
export interface RawExecutor {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Serialize "is this customer's ID approved?" decisions for one customer:
 * a booking being created and an ID approval for the same customer never
 * interleave, so a booking can't be created as PENDING_ID_VERIFICATION
 * just after the approval has reconciled the customer's waiting bookings.
 * Transaction-scoped (released at commit/rollback).
 */
export async function lockCustomerIdState(
  tx: RawExecutor,
  tenantId: string,
  userId: string,
): Promise<void> {
  const key = `rental-id:${tenantId}:${userId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
