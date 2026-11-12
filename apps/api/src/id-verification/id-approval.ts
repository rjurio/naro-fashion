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

/** Minimal shape of a Prisma client used to read a customer's documents. */
export interface IdDocLister {
  customerIDDocument: { findMany(args: any): Promise<any[]> };
}

/**
 * The customer's National ID situation, for the booking hold rules
 * (rentals/rental-hold.ts): APPROVED if any document is approved, else the
 * state of the most recent document (PENDING = waiting for staff review,
 * REJECTED = the latest one was not approved), else NONE. `approvedAt` /
 * `rejectedAt` are the review times used when adopting legacy bookings.
 */
export async function customerIdState(
  db: IdDocLister,
  tenantId: string,
  userId: string,
): Promise<{ state: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NONE'; approvedAt: Date | null; rejectedAt: Date | null }> {
  const docs = await db.customerIDDocument.findMany({
    where: { tenantId, userId },
    select: { verificationStatus: true, verifiedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const approved = docs.find((d) => d.verificationStatus === 'APPROVED');
  if (approved) return { state: 'APPROVED', approvedAt: approved.verifiedAt ?? approved.updatedAt ?? null, rejectedAt: null };
  const latest = docs[0];
  if (!latest) return { state: 'NONE', approvedAt: null, rejectedAt: null };
  if (latest.verificationStatus === 'PENDING') return { state: 'PENDING', approvedAt: null, rejectedAt: null };
  return { state: 'REJECTED', approvedAt: null, rejectedAt: latest.verifiedAt ?? latest.updatedAt ?? null };
}
