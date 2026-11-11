import * as bcryptNs from 'bcryptjs';
import { AuthService, GENERIC_LOGIN_ERROR } from './auth.service';
import {
  ADMIN_ACCOUNT_FAILURE_LIMIT,
  ADMIN_PER_IP_FAILURE_LIMIT,
  ADMIN_LOCK_WINDOW_MS,
  ADMIN_TRUSTED_NETWORK_MS,
  WindowCounter,
} from './util/admin-lockout';

/**
 * P0d (round 7): administrator lockout without a single-IP denial of service
 * and without unlimited password guessing. A stateful fake of the admin row
 * and the LoginAttempt log, so the tiers interact as they do in production.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt: typeof bcryptNs = require('bcryptjs');

interface Attempt { email: string; isAdmin: boolean; success: boolean; ipAddress: string | null; attemptedAt: Date }

function makeWorld(over: Partial<any> = {}) {
  let clock = Date.parse('2026-11-11T08:00:00Z');
  const now = () => new Date(clock);
  const attempts: Attempt[] = [];
  const admin: any = { id: 'a1', email: 'owner@naro.tz', tenantId: 't1', isActive: true, deletedAt: null, role: 'SUPER_ADMIN', is2FAEnabled: false, twoFASecret: null, failedLoginAttempts: 0, lockedUntil: null, tokenVersion: 0, ...over };
  const matches = (a: Attempt, w: any) =>
    a.email === w.email && (w.isAdmin === undefined || a.isAdmin === w.isAdmin) &&
    (w.ipAddress === undefined || a.ipAddress === w.ipAddress) &&
    (w.success === undefined || a.success === w.success) &&
    (!w.attemptedAt?.gt || a.attemptedAt > w.attemptedAt.gt);
  const adminDelegate = {
    findUnique: jest.fn(async () => ({ ...admin })),
    update: jest.fn(async ({ data, select }: any) => {
      if (data.failedLoginAttempts?.increment) admin.failedLoginAttempts += data.failedLoginAttempts.increment;
      else if (data.failedLoginAttempts === 0) admin.failedLoginAttempts = 0;
      if ('lockedUntil' in data) admin.lockedUntil = data.lockedUntil;
      return select ? { failedLoginAttempts: admin.failedLoginAttempts } : { ...admin };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.lockedUntil?.lte && !(admin.lockedUntil && admin.lockedUntil <= where.lockedUntil.lte)) return { count: 0 };
      if (where.failedLoginAttempts?.gt !== undefined && !(admin.failedLoginAttempts > where.failedLoginAttempts.gt)) return { count: 0 };
      if (data.failedLoginAttempts?.decrement) admin.failedLoginAttempts -= data.failedLoginAttempts.decrement;
      if (data.failedLoginAttempts === 0) admin.failedLoginAttempts = 0;
      if ('lockedUntil' in data) admin.lockedUntil = data.lockedUntil;
      return { count: 1 };
    }),
  };
  const prisma: any = {
    adminUser: adminDelegate,
    platformAdmin: { findUnique: jest.fn(async () => null) },
    user: { findFirst: jest.fn(async () => null) },
    loginAttempt: {
      create: jest.fn(async ({ data }: any) => { attempts.push({ ...data, attemptedAt: now() }); return {}; }),
      count: jest.fn(async ({ where }: any) => attempts.filter((a) => matches(a, where)).length),
      findFirst: jest.fn(async ({ where }: any) =>
        attempts.filter((a) => matches(a, where)).sort((x, y) => +y.attemptedAt - +x.attemptedAt)[0] ?? null),
    },
    adminActivityLog: { create: jest.fn() },
  };
  const svc = new AuthService(prisma, { sign: jest.fn(), verify: jest.fn() } as any, { get: (_k: string, d?: any) => d } as any, {} as any);
  // the service reads the clock via `new Date()` / Date.now()
  const realNow = Date.now;
  const tick = (ms: number) => { clock += ms; };
  beforeEachClock(() => clock);
  const signIn = async (password: string, ip: string | null) => {
    try { return (await svc.validateUser(admin.email, password, null, { ipAddress: ip ?? undefined } as any)) ? 'OK' : 'WRONG'; }
    catch (e: any) { if (e.message === GENERIC_LOGIN_ERROR) return 'REFUSED'; throw e; }
  };
  return { svc, prisma, admin, attempts, tick, now, signIn, realNow };
}

// Freeze Date for the service to the world clock.
let clockFn: (() => number) | null = null;
function beforeEachClock(fn: () => number) { clockFn = fn; }
const RealDate = Date;
beforeAll(() => {
  // @ts-expect-error test clock
  global.Date = class extends RealDate {
    constructor(...a: any[]) { if (a.length) { super(...(a as [any])); } else { super(clockFn ? clockFn() : RealDate.now()); } }
    static now() { return clockFn ? clockFn() : RealDate.now(); }
  };
});
afterAll(() => { global.Date = RealDate; });

const GOOD = 'Correct1pass';
let hash: string;
beforeAll(async () => { hash = await bcrypt.hash(GOOD, 4); });
// Refusals deliberately cost one cost-12 bcrypt run against a dummy hash
// (equal timing). Keep those calls (they are counted) but make them instant
// here; comparisons against the real password hash still use real bcrypt.
const realCompare = bcrypt.compare.bind(bcrypt);
let compareSpy: jest.SpyInstance;
beforeEach(() => {
  compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementation((async (p: string, h: string) => (h === hash ? realCompare(p, h) : false)) as any);
});
afterEach(() => compareSpy.mockRestore());
const world = (over: any = {}) => makeWorld({ passwordHash: hash, ...over });

describe('password attempts, per account + IP', () => {
  it(`one IP gets ${ADMIN_PER_IP_FAILURE_LIMIT} tries, then is refused for this account — even with the right password`, async () => {
    const w = world();
    for (let i = 0; i < ADMIN_PER_IP_FAILURE_LIMIT; i++) expect(await w.signIn('wrong', '6.6.6.6')).toBe('WRONG');
    expect(await w.signIn('wrong', '6.6.6.6')).toBe('REFUSED');
    expect(await w.signIn(GOOD, '6.6.6.6')).toBe('REFUSED');
  });

  it('…and that does NOT lock the owner out from their own network (no single-IP denial of service)', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) await w.signIn('wrong', '6.6.6.6');
    expect(w.admin.lockedUntil).toBeNull(); // the refused attempts never reached the account counter
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('OK');
  });

  it('a successful sign-in from an IP resets that IP’s count', async () => {
    const w = world();
    for (let i = 0; i < ADMIN_PER_IP_FAILURE_LIMIT - 1; i++) await w.signIn('wrong', '10.0.0.5');
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('OK');
    w.tick(1000);
    for (let i = 0; i < ADMIN_PER_IP_FAILURE_LIMIT - 1; i++) expect(await w.signIn('wrong', '10.0.0.5')).toBe('WRONG');
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('OK');
  });

  it('the per-IP block expires after the window', async () => {
    const w = world();
    for (let i = 0; i < ADMIN_PER_IP_FAILURE_LIMIT; i++) await w.signIn('wrong', '6.6.6.6');
    expect(await w.signIn(GOOD, '6.6.6.6')).toBe('REFUSED');
    w.tick(ADMIN_LOCK_WINDOW_MS + 1000);
    expect(await w.signIn(GOOD, '6.6.6.6')).toBe('OK');
  });
});

describe('distributed attacks (many IPs)', () => {
  it(`${ADMIN_ACCOUNT_FAILURE_LIMIT} failures across IPs lock the account for untrusted networks`, async () => {
    const w = world();
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) expect(await w.signIn('wrong', `203.0.113.${i}`)).toBe('WRONG');
    expect(w.admin.lockedUntil).toBeInstanceOf(Date);
    expect(await w.signIn(GOOD, '198.51.100.1')).toBe('REFUSED'); // a new network, even with the right password
  });

  it('…but the owner’s trusted network (a successful sign-in in the last 30 days) still gets in, which clears the lock', async () => {
    const w = world();
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('OK'); // owner signed in from the office earlier
    w.tick(3 * 24 * 3600_000);
    for (let i = 0; i < 25; i++) await w.signIn('wrong', `203.0.113.${i}`);
    expect(w.admin.lockedUntil).toBeInstanceOf(Date);
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('OK');
    expect(w.admin.lockedUntil).toBeNull();
    expect(w.admin.failedLoginAttempts).toBe(0);
  });

  it('a trusted network is still capped per IP while the account is locked (no bypass for guessing)', async () => {
    const w = world();
    await w.signIn(GOOD, '10.0.0.5');
    w.tick(1000);
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) await w.signIn('wrong', `203.0.113.${i}`);
    for (let i = 0; i < ADMIN_PER_IP_FAILURE_LIMIT; i++) expect(await w.signIn('wrong', '10.0.0.5')).toBe('WRONG');
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('REFUSED');
  });

  it('trust expires after 30 days', async () => {
    const w = world();
    await w.signIn(GOOD, '10.0.0.5');
    w.tick(ADMIN_TRUSTED_NETWORK_MS + 1000);
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) await w.signIn('wrong', `203.0.113.${i}`);
    expect(await w.signIn(GOOD, '10.0.0.5')).toBe('REFUSED');
  });

  it('bounded guessing: 1,000 attacker IPs get only 10 real password checks per window', async () => {
    const w = world();
    compareSpy.mockClear();
    for (let i = 0; i < 1000; i++) await w.signIn(`guess-${i}`, `10.${i >> 8}.${i & 255}.9`);
    const realChecks = compareSpy.mock.calls.filter((c) => c[1] === hash).length;
    expect(compareSpy.mock.calls.length).toBe(1000); // every attempt still costs one comparison
    expect(realChecks).toBe(ADMIN_ACCOUNT_FAILURE_LIMIT);
  });

  it('every refusal looks the same and costs one bcrypt comparison', async () => {
    const w = world();
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) await w.signIn('wrong', `203.0.113.${i}`);
    compareSpy.mockClear();
    expect(await w.signIn(GOOD, '198.51.100.1')).toBe('REFUSED');
    expect(compareSpy).toHaveBeenCalledTimes(1);
    expect(compareSpy.mock.calls[0][1]).not.toBe(hash); // the dummy, never the real hash
  });

  it('the lock expires after 30 minutes', async () => {
    const w = world();
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) await w.signIn('wrong', `203.0.113.${i}`);
    w.tick(ADMIN_LOCK_WINDOW_MS + 1000);
    expect(await w.signIn(GOOD, '198.51.100.1')).toBe('OK');
  });
});

describe('legitimate recovery', () => {
  it('a password reset (proves the mailbox) clears the account lock and the two-factor limit', async () => {
    const w = world();
    for (let i = 0; i < ADMIN_ACCOUNT_FAILURE_LIMIT; i++) await w.signIn('wrong', `203.0.113.${i}`);
    (w.svc as any).twoFaAccountFailures.hit('admin:a1');
    w.prisma.adminUser.findFirst = jest.fn(async () => ({ id: 'a1' }));
    w.prisma.adminUser.update.mockImplementationOnce(async ({ data }: any) => { w.admin.failedLoginAttempts = data.failedLoginAttempts; w.admin.lockedUntil = data.lockedUntil; return {}; });
    await w.svc.resetPassword('token-from-email', 'NewPassw0rd!');
    expect(w.admin.lockedUntil).toBeNull();
    expect((w.svc as any).twoFaAccountFailures.count('admin:a1')).toBe(0);
  });
});

describe('WindowCounter', () => {
  it('counts within the window, resets after it, and clears on demand', () => {
    const c = new WindowCounter(1000);
    expect(c.hit('k', 0)).toBe(1);
    expect(c.hit('k', 500)).toBe(2);
    expect(c.count('k', 999)).toBe(2);
    expect(c.count('k', 1001)).toBe(0);
    expect(c.hit('k', 1001)).toBe(1);
    c.clear('k');
    expect(c.count('k', 1002)).toBe(0);
  });
});
