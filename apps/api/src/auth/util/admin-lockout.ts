/**
 * Admin / platform-admin sign-in protection (P0d, Nov 2026). No migration:
 * the per-IP facts come from the existing LoginAttempt log; the account tier
 * keeps the existing failedLoginAttempts/lockedUntil.
 *
 *  1. PASSWORD, per account + IP: 5 failed sign-in steps from one IP within
 *     30 min (counted since that IP's last successful sign-in, or since the
 *     account was last reset / unlocked) -> that IP is refused for that
 *     account. One attacker can no longer lock the account.
 *  2. PASSWORD, per account (distributed): 10 failures across all IPs -> the
 *     account is locked for 30 min from EVERY network. There is no
 *     trusted-network or remembered-device exception (owner decision
 *     2026-11-11): guessing is bounded at 10 real password checks per
 *     account per window, whatever the number of attacker IPs.
 *  3. TWO-FACTOR codes, separate from the password counters: 5 wrong codes
 *     burn the challenge (the password must be entered again), and 10 wrong
 *     codes per account within 30 min lock the code step for 30 min from
 *     every network (a wrong code means the password is already known).
 *  4. RECOVERY for the real admin: a password reset by email (clears the
 *     account lock, every per-IP block and the two-factor limit), an unlock
 *     by another admin with `admins:unlock` (clears the account lock and the
 *     per-IP blocks), or waiting: every lock expires after 30 min.
 *
 * Residual risk, accepted: a distributed attacker who knows the email can
 * keep the account locked (denial of service, not access). Recovery above
 * still works; a device-bound exception is a later, separate decision.
 *
 * Every refusal returns the same generic message and costs one bcrypt
 * comparison (equalizeLoginTiming), so none of this reveals account state.
 */
export const ADMIN_LOCK_WINDOW_MS = 30 * 60 * 1000;
export const ADMIN_PER_IP_FAILURE_LIMIT = 5;
export const ADMIN_ACCOUNT_FAILURE_LIMIT = 10;
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
  clearedAt: Date | undefined = adminLockClears.get(email),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - ADMIN_LOCK_WINDOW_MS);
  const ipAddress = ip ?? null;
  const lastOk = await db.loginAttempt.findFirst({
    where: { email, isAdmin: true, ipAddress, success: true, attemptedAt: { gt: windowStart } },
    orderBy: { attemptedAt: 'desc' },
    select: { attemptedAt: true },
  });
  let since = lastOk?.attemptedAt && lastOk.attemptedAt > windowStart ? lastOk.attemptedAt : windowStart;
  if (clearedAt && clearedAt > since) since = clearedAt;
  const failures = await db.loginAttempt.count({
    where: { email, isAdmin: true, ipAddress, success: false, attemptedAt: { gt: since } },
  });
  return (failures ?? 0) >= ADMIN_PER_IP_FAILURE_LIMIT;
}

/**
 * When each account's lock was last cleared by a password reset or an admin
 * unlock. Failures before that no longer count towards the per-IP tier, so
 * recovery really unblocks the admin's own network. In memory (one API
 * process, like the two-factor counters): after a restart the marker is
 * gone and older failures count again until the 30-min window passes,
 * which errs on the safe side.
 */
export class LockClearMarks {
  private readonly m = new Map<string, Date>();

  private key(email: string) {
    return email.trim().toLowerCase();
  }

  mark(email: string, at = new Date()): void {
    this.m.set(this.key(email), at);
    if (this.m.size > 5000) {
      const cutoff = Date.now() - ADMIN_LOCK_WINDOW_MS;
      for (const [k, d] of this.m) if (d.getTime() < cutoff) this.m.delete(k);
    }
  }

  get(email: string): Date | undefined {
    return this.m.get(this.key(email));
  }
}

/** Shared by AuthService (password reset) and AdminUsersService (unlock). */
export const adminLockClears = new LockClearMarks();

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
