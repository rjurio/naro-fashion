/**
 * Round 25F E — which manual stock changes need a second person.
 *
 *  - Increases (RESTOCK, ADJUSTMENT INCREASE) never need approval: they can't
 *    hide a loss (a buy-or-rent RESTOCK still needs a note).
 *  - Decreases (DAMAGE write-offs, ADJUSTMENT DECREASE) hide shrinkage when
 *    abused, so they need an independent approver (`inventory:approve`) —
 *    EXCEPT a routine decrease within the shop's owner-set threshold.
 *  - Thresholds are counted in units and / or % of the variant's current
 *    stock (never money), stored per shop. There is NO default: until the
 *    owner sets one, EVERY decrease needs approval (fail safe).
 *    A decrease is one-step only if it satisfies every threshold that is set.
 */
export const THRESHOLD_KEYS = {
  maxUnits: 'inventory_decrease_auto_max_units',
  maxPct: 'inventory_decrease_auto_max_pct',
} as const;

export interface DecreaseThresholds {
  /** A decrease of at most this many units may be one-step (null = not set). */
  maxUnits: number | null;
  /** ...and at most this % of the stock before (null = not set). */
  maxPct: number | null;
}

export type Direction = 'INCREASE' | 'DECREASE';

export function directionOf(type: string, direction?: string | null): Direction {
  if (type === 'DAMAGE') return 'DECREASE';
  if (type === 'ADJUSTMENT' && direction === 'DECREASE') return 'DECREASE';
  return 'INCREASE';
}

export function parseThreshold(raw: string | null | undefined, max?: number): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || (max != null && n > max)) return null;
  return n;
}

export function approvalRequired(
  change: { type: string; direction?: string | null; quantity: number; stockBefore: number },
  th: DecreaseThresholds,
): { required: boolean; reason: string } {
  if (directionOf(change.type, change.direction) === 'INCREASE') return { required: false, reason: 'INCREASE' };
  if (th.maxUnits == null && th.maxPct == null) return { required: true, reason: 'NO_THRESHOLD_SET' };
  if (th.maxUnits != null && change.quantity > th.maxUnits) return { required: true, reason: 'OVER_UNIT_THRESHOLD' };
  if (th.maxPct != null && (change.stockBefore <= 0 || change.quantity * 100 > th.maxPct * change.stockBefore)) {
    return { required: true, reason: 'OVER_PERCENT_THRESHOLD' };
  }
  return { required: false, reason: 'WITHIN_THRESHOLD' };
}
