/**
 * Admin / platform-admin sign-in protection (P0d, Nov 2026). No migration:
 * the per-IP and trusted-network facts come from the existing LoginAttempt
 * log; the account tier keeps the existing failedLoginAttempts/lockedUntil.
 *
 *  1. PASSWORD, per account + IP: 5 failed sign-in steps from one IP within
 *     30 min (counted since that IP's last successful sign-in) → that IP is
 *     refused for that account. One attacker can no longer lock the account.
 *  2. PASSWORD, per account (distributed): 10 failures across all IPs → the
 *     account is locked for 30 min. While locked, only TRUSTED networks (an IP
 *     with a full successful sign-in for this account in the last 30 days)
 *     may still try, and each of them stays limited by tier 1. Guessing stays
 *     bounded: ≤10 per window from untrusted IPs together, ≤5 per window from
 *     each trusted IP, and trusted IPs are only the ones the real admin used.
 *  3. TWO-FACTOR codes, separate from the password counters: 5 wrong codes
 *     burn the challenge (the password must be entered again), and 10 wrong
 *     codes per account within 30 min lock the code step for 30 min from
 *     every network (a wrong code means the password is already known).
 *  4. RECOVERY for the real admin: their usual network keeps working during
 *     a distributed attack; elsewhere a password reset by email, or an
 *     unlock by another admin (`admins:unlock`) / the platform, clears the
 *     account lock; every lock also expires after 30 min. A password reset
 *     also clears the two-factor counter.
 *
 * Every refusal returns the same generic message and costs one bcrypt
 * comparison (equalizeLoginTiming), so none of this reveals account state.
 */
export const ADMIN_LOCK_WINDOW_MS = 30 * 60 * 1000;
export const ADMIN_PER_IP_FAILURE_LIMIT = 5;
export const ADMIN_ACCOUNT_FAILURE_LIMIT = 10;
export const ADMIN_TRUSTED_NETWORK_MS = 30 * 24 * 60 * 60 * 1000;
export const TWO_FA_PER_CHALLENGE_LIMIT = 5;
export const TWO_FA_ACCOUNT_LIMIT = 10;

interface LoginAttemptReader {
  loginAttempt: {
    count: (args: any) => Promise<number>;
    findFirst: (args: any) => Promise<{ attemptedAt: Date } | null | undefined>;
  };
}

/** Tier 1: has this IP used up its failures for this account? */
export async function isIpBlockedForAccount(
  db: LoginAttemptReader,
  email: string,
  ip: string | null | undefined,
  now = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - ADMIN_LOCK_WINDOW_MS);
  const ipAddress = ip ?? null;
  const lastOk = await db.loginAttempt.findFirst({
    where: { email, isAdmin: true, ipAddress, success: true, attemptedAt: { gt: windowStart } },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  });
  const since = lastOk?.attemptedAt && lastOk.attemptedAt > windowStart ? lastOk.attemptedAt : windowStart;
  const failures = await db.loginAttempt.count({
    where: { email, isAdmin: true, ipAddress, success: false, attemptedAt: { gt: since } },
  });
  return (failures ?? 0) >= ADMIN_PER_IP_FAILURE_LIMIT;
}

/** Tier 2 exception: a network this admin fully signed in from recently. */
export async function isTrustedNetwork(
  db: LoginAttemptReader,
  email: string,
  ip: string | null | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!ip) return false;
  const hit = await db.loginAttempt.findFirst({
    where: { email, isAdmin: true, ipAddress: ip, success: true, attemptedAt: { gt: new Date(now.getTime() - ADMIN_TRUSTED_NETWORK_MS) } },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  });
  return !!hit;
}

/** Fixed-window counter (in memory; one API process, like the challenge-replay set). */
export class WindowCounter {
  private readonly m = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly windowMs: number) {}

  count(key: string, now = Date.now()): number {
    const e = this.m.get(key);
    if (!e || e.resetAt <= now) return 0;
    return e.count;
  }

  hit(key: string, now = Date.now()): number {
    this.prune(now);
    const e = this.m.get(key);
    if (!e || e.resetAt <= now) {
      this.m.set(key, { count: 1, resetAt: now + this.windowMs });
      return 1;
    }
    e.count += 1;
    return e.count;
  }

  clear(key: string): void {
    this.m.delete(key);
  }

  private prune(now: number) {
    if (this.m.size < 5000) return;
    for (const [k, e] of this.m) if (e.resetAt <= now) this.m.delete(k);
  }
}
