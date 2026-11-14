import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/**
 * R3 mandatory rental checklist — the rules, as plain Prisma functions (no
 * DI) so request-scoped services AND singletons (payment settlement) share
 * one implementation.
 *
 *  - A booking's checklist is a SNAPSHOT frozen at confirmation from the most
 *    specific active template: product → category → shop default.
 *  - Evidence is append-only (RentalChecklistRecord); the effective record
 *    per item and stage is the one no other record supersedes.
 *  - Hand-over: every mandatory BOTH-stage item has an effective HANDOVER
 *    record with at least the snapshot quantity and (when required) a
 *    condition other than MISSING — or is covered by an APPROVED exception
 *    whose decider is not the person handing over. The gown on the booking
 *    must be the gown the snapshot names.
 *  - Return: every snapshot item gets a RETURN record; shortfalls and worse
 *    conditions open per-item discrepancies; closing the rental and
 *    settling its deposit need a complete inspection and no OPEN
 *    discrepancy. No amount is ever computed.
 */
export const CHECKLIST_STAGES = ['HANDOVER', 'RETURN'] as const;
export const CONDITIONS = ['GOOD', 'MINOR_WEAR', 'DAMAGED', 'MISSING', 'ALTERED'] as const;
export const DISCREPANCY_RESOLUTIONS = ['RESOLVED_NO_CHARGE', 'RESOLVED_DEDUCTED', 'RESOLVED_WAIVED'] as const;
/** A booking becomes "confirmed" at these statuses: the snapshot freezes. */
export const CONFIRMED_STATUSES = ['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'];

const CONDITION_RANK: Record<string, number> = { GOOD: 0, MINOR_WEAR: 1, ALTERED: 2, DAMAGED: 3, MISSING: 4 };

export async function lockChecklist(tx: any, rentalOrderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'checklist:' + rentalOrderId}))`;
}

/**
 * Declare, inside the current transaction, that the R3 gate passed for this
 * rental. The value is bound to the booking, to THIS transaction's id and to
 * the acting staff member ("<rentalId>:<txid>:<actorId>"), so it can't leak
 * to another booking, be replayed in a later transaction or survive on a
 * pooled connection. The database triggers (migrations 20261115090000 +
 * 20261116090000) additionally re-check the checklist facts themselves, so the
 * declaration alone never authorises anything.
 */
export type R3Step = 'handover' | 'close' | 'deposit';
export async function declareGatePassed(tx: any, step: R3Step, rentalOrderId: string, actorId?: string | null) {
  const key = `naro.r3_${step}`;
  const actor = actorId ?? '';
  await tx.$executeRaw`SELECT set_config(${key}, ${rentalOrderId} || ':' || txid_current()::text || ':' || ${actor}, true)`;
}

/** The most specific ACTIVE template for a product (product → category → shop default). */
export async function resolveTemplate(db: any, tenantId: string, product: { id: string; categoryId?: string | null }) {
  const base = { tenantId, isActive: true, deletedAt: null };
  const include = { items: { orderBy: { sortOrder: 'asc' } } };
  const byProduct = await db.rentalChecklistTemplate.findFirst({ where: { ...base, productId: product.id }, include, orderBy: { updatedAt: 'desc' } });
  if (byProduct) return { template: byProduct, source: 'PRODUCT' };
  // The product's category, then its parent categories (a "Wedding Dresses"
  // list covers the gowns filed under "Wedding Dresses > Ball Gown").
  let categoryId = product.categoryId ?? null;
  for (let depth = 0; categoryId && depth < 6; depth++) {
    const byCat = await db.rentalChecklistTemplate.findFirst({ where: { ...base, productId: null, categoryId }, include, orderBy: { updatedAt: 'desc' } });
    if (byCat) return { template: byCat, source: 'CATEGORY' };
    const cat = db.category?.findFirst ? await db.category.findFirst({ where: { id: categoryId, tenantId }, select: { parentId: true } }) : null;
    categoryId = cat?.parentId ?? null;
  }
  const dflt = await db.rentalChecklistTemplate.findFirst({ where: { ...base, productId: null, categoryId: null, isDefault: true }, include, orderBy: { updatedAt: 'desc' } });
  if (dflt) return { template: dflt, source: 'SHOP_DEFAULT' };
  return { template: null, source: 'NONE' };
}

/**
 * Freeze the booking's checklist (idempotent: an existing snapshot is never
 * replaced). `actorId` null = automatic at confirmation.
 */
export async function freezeSnapshot(db: any, tenantId: string, rentalOrderId: string, actorId: string | null, legacyDesk = false) {
  const existing = await db.rentalChecklistSnapshot.findFirst({ where: { tenantId, rentalOrderId } });
  if (existing) return { snapshot: existing, created: false };
  const rental = await db.rentalOrder.findFirst({
    where: { id: rentalOrderId, tenantId },
    select: { id: true, productId: true, rentalUnitId: true, product: { select: { id: true, categoryId: true } }, rentalUnit: { select: { code: true } } },
  });
  if (!rental) return { snapshot: null, created: false };
  const { template, source } = await resolveTemplate(db, tenantId, rental.product);
  try {
    const snapshot = await db.rentalChecklistSnapshot.create({
      data: {
        tenantId, rentalOrderId, templateId: template?.id ?? null, templateVersion: template?.version ?? null,
        source: legacyDesk ? 'LEGACY_DESK' : source, rentalUnitId: rental.rentalUnitId ?? null, unitCode: rental.rentalUnit?.code ?? null,
        frozenById: actorId,
        items: {
          create: (template?.items ?? []).map((i: any, n: number) => ({
            tenantId, label: i.label, labelSwahili: i.labelSwahili ?? null, stage: i.itemType === 'RETURN' ? 'RETURN' : 'BOTH',
            quantity: Math.max(1, Number(i.quantity ?? 1)), isMandatory: i.isMandatory !== false, requiresCondition: i.requiresCondition !== false,
            instructions: i.instructions ?? null, sortOrder: i.sortOrder ?? n, templateItemId: i.id,
          })),
        },
      },
    });
    return { snapshot, created: true, source: legacyDesk ? 'LEGACY_DESK' : source };
  } catch (e: any) {
    if (e?.code === 'P2002') return { snapshot: await db.rentalChecklistSnapshot.findFirst({ where: { tenantId, rentalOrderId } }), created: false };
    throw e;
  }
}

/**
 * The current picture of a booking's checklist. `unitId` = the gown the
 * booking holds now: hand-over evidence recorded on another gown doesn't
 * count (a swap needs new evidence; the old records stay as history).
 */
export async function checklistState(db: any, tenantId: string, rentalOrderId: string, unitId?: string | null) {
  const snapshot = await db.rentalChecklistSnapshot.findFirst({
    where: { tenantId, rentalOrderId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  const [records, exceptions, discrepancies] = await Promise.all([
    db.rentalChecklistRecord.findMany({ where: { tenantId, rentalOrderId }, orderBy: { recordedAt: 'asc' } }),
    db.rentalChecklistException.findMany({ where: { tenantId, rentalOrderId }, orderBy: { createdAt: 'asc' } }),
    db.rentalDiscrepancy.findMany({ where: { tenantId, rentalOrderId }, orderBy: { openedAt: 'asc' } }),
  ]);
  const superseded = new Set(records.map((r: any) => r.supersedesId).filter(Boolean));
  const effective = (itemId: string, stage: string) =>
    records
      .filter((r: any) => r.snapshotItemId === itemId && r.stage === stage && !superseded.has(r.id))
      .filter((r: any) => stage !== 'HANDOVER' || unitId === undefined || (r.rentalUnitId ?? null) === (unitId ?? null))
      .pop() ?? null;
  const usedOrApproved = exceptions.filter((e: any) => e.status === 'APPROVED' || e.status === 'USED');
  const items = (snapshot?.items ?? []).map((i: any) => {
    const handover = effective(i.id, 'HANDOVER');
    const exc = usedOrApproved.filter((e: any) => e.snapshotItemIds.includes(i.id));
    const missingExc = exc.find((e: any) => e.kind === 'MISSING') ?? null;
    const substitutedExc = exc.find((e: any) => e.kind === 'SUBSTITUTED') ?? null;
    return {
      ...i,
      handover,
      return: effective(i.id, 'RETURN'),
      // What physically went out, and therefore what the customer must bring back:
      //  - recorded at hand-over -> that quantity;
      //  - not recorded but covered by a MISSING exception -> nothing went out;
      //  - SUBSTITUTED -> the substitute went out (its description is on the exception);
      //  - otherwise (legacy desk list, return-only checks) -> the listed quantity.
      issuedQuantity: i.stage === 'RETURN' ? null : handover ? handover.quantity : missingExc ? 0 : null,
      expectedReturn: i.stage === 'RETURN' ? i.quantity : handover ? handover.quantity : missingExc ? 0 : i.quantity,
      exception: missingExc || substitutedExc ? { id: (missingExc ?? substitutedExc).id, kind: (missingExc ?? substitutedExc).kind, substituteNote: substitutedExc?.substituteNote ?? null } : null,
    };
  });
  return { snapshot, items, records, exceptions, discrepancies, effective };
}

/** Mandatory hand-over items still unresolved (labels), and the exceptions that cover others. */
export function handoverUnresolved(state: Awaited<ReturnType<typeof checklistState>>) {
  const approved = state.exceptions.filter((e: any) => e.status === 'APPROVED');
  const covered = new Set(approved.flatMap((e: any) => e.snapshotItemIds));
  const unresolved: string[] = [];
  const usedExceptions = new Set<string>();
  for (const i of state.items.filter((x: any) => x.stage === 'BOTH' && x.isMandatory)) {
    const h = i.handover;
    const ok = h && h.quantity >= i.quantity && (!i.requiresCondition || (h.condition && h.condition !== 'MISSING'));
    if (ok) continue;
    if (covered.has(i.id)) {
      approved.filter((e: any) => e.snapshotItemIds.includes(i.id)).forEach((e: any) => usedExceptions.add(e.id));
      continue;
    }
    unresolved.push(i.label);
  }
  return { unresolved, usedExceptions: [...usedExceptions] };
}

/** Throws 422 (missing list) / 403 (decider handing over). Returns the exceptions this hand-over uses. */
export async function assertChecklistReleasable(db: any, tenantId: string, rental: { id: string; rentalUnitId?: string | null }, actorId?: string | null): Promise<string[]> {
  const state = await checklistState(db, tenantId, rental.id, rental.rentalUnitId ?? null);
  const missing: string[] = [];
  let used: string[] = [];
  if (!state.snapshot) {
    const noSnap = state.exceptions.find((e: any) => e.status === 'APPROVED' && e.kind === 'NO_SNAPSHOT');
    if (noSnap) used = [noSnap.id];
    else missing.push('CHECKLIST_SNAPSHOT');
  } else {
    if (state.items.length === 0) {
      const noSnap = state.exceptions.find((e: any) => e.status === 'APPROVED' && e.kind === 'NO_SNAPSHOT');
      if (noSnap) used = [noSnap.id];
      else missing.push('CHECKLIST_EMPTY');
    } else {
      const h = handoverUnresolved(state);
      used = h.usedExceptions;
      if (h.unresolved.length) missing.push(...h.unresolved.map((l) => `CHECKLIST:${l}`));
    }
  }
  if (missing.length) {
    throw new UnprocessableEntityException({
      statusCode: 422, code: 'CHECKLIST_INCOMPLETE', missing,
      message: `The hand-over checklist isn't complete: ${missing.join(', ')}.`,
    });
  }
  if (actorId && used.length) {
    const deciders = state.exceptions.filter((e: any) => used.includes(e.id)).map((e: any) => e.decidedById);
    if (deciders.includes(actorId)) {
      throw new ForbiddenException({ statusCode: 403, code: 'EXCEPTION_DECIDER_HANDING_OVER', message: 'The person who approved the checklist exception cannot also hand the item over.' });
    }
  }
  return used;
}

/** Return inspection complete = every snapshot item has an effective RETURN record. */
export function inspectionGaps(state: Awaited<ReturnType<typeof checklistState>>) {
  // Nothing to inspect for an item that never went out (an approved MISSING exception).
  const notInspected = state.items.filter((i: any) => i.expectedReturn > 0 && !i.return).map((i: any) => i.label);
  const open = state.discrepancies.filter((d: any) => d.status === 'OPEN');
  return { notInspected, open };
}

/** Closing the rental / settling the deposit: inspection complete, nothing OPEN. Legacy bookings without a snapshot need a desk snapshot first. */
export async function assertInspectionComplete(db: any, tenantId: string, rentalOrderId: string, what: 'CLOSE' | 'DEPOSIT') {
  const state = await checklistState(db, tenantId, rentalOrderId);
  if (!state.snapshot) {
    throw new ConflictException({ statusCode: 409, code: 'INSPECTION_INCOMPLETE', message: 'Record the return inspection first (create the checklist for this booking at the desk).' });
  }
  const { notInspected, open } = inspectionGaps(state);
  if (notInspected.length || open.length) {
    throw new ConflictException({
      statusCode: 409, code: open.length ? 'DISCREPANCY_OPEN' : 'INSPECTION_INCOMPLETE', notInspected, openDiscrepancies: open.map((d: any) => d.id),
      message: what === 'CLOSE'
        ? `The rental can't be closed yet: ${[...notInspected.map((l: string) => `not inspected: ${l}`), ...open.map(() => 'an open discrepancy')].join(', ')}.`
        : `The deposit can't be settled yet: the return inspection is incomplete or a discrepancy is still open.`,
    });
  }
  return state;
}

/**
 * Settling the deposit after a hand-over: the inspection is complete, nothing
 * is OPEN, and keeping part of the deposit needs at least one discrepancy
 * resolved as RESOLVED_DEDUCTED (decided by a reviewer). Never computes an
 * amount.
 */
export async function assertDepositSettleable(db: any, tenantId: string, rentalOrderId: string, retainedAmount: number) {
  const state = await assertInspectionComplete(db, tenantId, rentalOrderId, 'DEPOSIT');
  if (retainedAmount > 0 && !state.discrepancies.some((d: any) => d.status === 'RESOLVED_DEDUCTED')) {
    throw new ConflictException({
      statusCode: 409, code: 'RETENTION_WITHOUT_DISCREPANCY',
      message: 'Part of the deposit can be kept only for a discrepancy a reviewer resolved as "deducted".',
    });
  }
  return state;
}

/** Discrepancies a RETURN observation opens against what went out. */
export function discrepanciesFor(item: { quantity: number; stage: string; expectedReturn?: number }, handover: { quantity: number; condition?: string | null } | null, ret: { quantity: number; condition?: string | null }) {
  const out: Array<{ kind: 'MISSING' | 'DAMAGED' | 'ALTERED'; quantity: number }> = [];
  // The customer owes back only what was actually issued (see checklistState.expectedReturn).
  const expected = item.expectedReturn ?? (item.stage === 'BOTH' ? (handover?.quantity ?? item.quantity) : item.quantity);
  if (expected === 0) return out;
  if (ret.quantity < expected || ret.condition === 'MISSING') out.push({ kind: 'MISSING', quantity: Math.max(1, expected - (ret.condition === 'MISSING' ? 0 : ret.quantity)) });
  const before = CONDITION_RANK[handover?.condition ?? 'GOOD'] ?? 0;
  const after = CONDITION_RANK[ret.condition ?? 'GOOD'] ?? 0;
  if (ret.condition === 'ALTERED' && before < CONDITION_RANK.ALTERED) out.push({ kind: 'ALTERED', quantity: Math.max(1, Math.min(ret.quantity, expected)) });
  else if (ret.condition !== 'MISSING' && after > before && after >= CONDITION_RANK.DAMAGED) out.push({ kind: 'DAMAGED', quantity: Math.max(1, Math.min(ret.quantity, expected)) });
  return out;
}
