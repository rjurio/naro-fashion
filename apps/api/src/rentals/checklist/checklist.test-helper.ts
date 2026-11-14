/**
 * Test helper (used by specs only): Prisma mock fragments for a booking whose
 * R3 checklist is complete — one mandatory item checked at hand-over and on
 * return, no exception, no discrepancy — plus a pass-through $transaction.
 * Spread into a spec's prisma mock when the case under test is about
 * something else than the checklist.
 */
export function completeChecklistMocks(prisma: () => any, opts: { rentalUnitId?: string | null } = {}) {
  const unit = opts.rentalUnitId ?? null;
  const item = { id: 'ci1', label: 'Gown', stage: 'BOTH', quantity: 1, isMandatory: true, requiresCondition: true, sortOrder: 0 };
  return {
    $transaction: jest.fn(async (fn: any) => fn(prisma())),
    $executeRaw: jest.fn(async () => 1),
    rentalChecklistSnapshot: { findFirst: jest.fn(async () => ({ id: 'cs1', rentalUnitId: unit, items: [item] })) },
    rentalChecklistRecord: {
      findMany: jest.fn(async () => [
        { id: 'cr1', snapshotItemId: 'ci1', stage: 'HANDOVER', quantity: 1, condition: 'GOOD', rentalUnitId: unit, supersedesId: null },
        { id: 'cr2', snapshotItemId: 'ci1', stage: 'RETURN', quantity: 1, condition: 'GOOD', rentalUnitId: unit, supersedesId: null },
      ]),
    },
    rentalChecklistException: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
    rentalDiscrepancy: { findMany: jest.fn(async () => []) },
  };
}
