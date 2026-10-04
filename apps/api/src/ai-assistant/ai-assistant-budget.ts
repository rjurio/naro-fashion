/**
 * Per-tenant daily request budget for the AI assistant (each chat request
 * can fan out into up to MAX_ITERATIONS paid Anthropic calls).
 *
 * Limit: env `AI_ASSISTANT_DAILY_REQUEST_LIMIT` (default 200 chat requests
 * per tenant per UTC day; `0` disables the assistant).
 *
 * IN-MEMORY by design: prod runs a single PM2 instance, so one process holds
 * the authoritative counter. Caveats: the counter resets on API restart, and
 * if the API is ever scaled to N instances the effective cap becomes N×limit
 * — move this to a DB/Redis counter at that point.
 */
export const DEFAULT_AI_DAILY_REQUEST_LIMIT = 200;

export function resolveDailyLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_AI_DAILY_REQUEST_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_AI_DAILY_REQUEST_LIMIT;
  return Math.floor(n);
}

export class AiDailyBudget {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limitFn: () => number = () =>
    resolveDailyLimit(process.env.AI_ASSISTANT_DAILY_REQUEST_LIMIT)) {}

  private static day(now: Date): string {
    return now.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  }

  /**
   * Consume one unit for the tenant. Returns { allowed, used, limit }.
   * Does not increment when the budget is exhausted.
   */
  consume(tenantId: string, now: Date = new Date()): { allowed: boolean; used: number; limit: number } {
    const limit = this.limitFn();
    const day = AiDailyBudget.day(now);
    // Drop counters from previous days so the map can't grow unbounded.
    for (const key of this.counts.keys()) {
      if (!key.endsWith(`|${day}`)) this.counts.delete(key);
    }
    const key = `${tenantId}|${day}`;
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) return { allowed: false, used, limit };
    this.counts.set(key, used + 1);
    return { allowed: true, used: used + 1, limit };
  }

  /** Refund a unit (e.g. request rejected before any model call). */
  refund(tenantId: string, now: Date = new Date()) {
    const key = `${tenantId}|${AiDailyBudget.day(now)}`;
    const used = this.counts.get(key) ?? 0;
    if (used > 0) this.counts.set(key, used - 1);
  }
}
