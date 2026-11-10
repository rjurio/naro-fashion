import * as bcryptNs from 'bcryptjs';
import { AuthService, GENERIC_LOGIN_ERROR } from './auth.service';

/**
 * P0d: sign-in must not reveal which emails have accounts.
 *
 * Messages were already uniform (GENERIC_LOGIN_ERROR / null → the same 401).
 * Timing was not: an unknown email skipped bcrypt and answered ~100 ms
 * faster. Every failure now costs exactly ONE bcrypt comparison.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt: typeof bcryptNs = require('bcryptjs');

function makePrisma() {
  const delegate = () => ({
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ failedLoginAttempts: 1 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({}),
  });
  return { user: delegate(), adminUser: delegate(), platformAdmin: delegate(), loginAttempt: delegate(), adminActivityLog: delegate() };
}

describe('sign-in timing does not reveal whether an account exists', () => {
  let hash: string;
  let spy: jest.SpyInstance;
  beforeAll(async () => {
    hash = await bcrypt.hash('Correct1pass', 4);
  });
  beforeEach(() => {
    spy = jest.spyOn(bcrypt, 'compare');
  });
  afterEach(() => spy.mockRestore());

  const make = () => {
    const prisma = makePrisma();
    const config = { get: jest.fn((_k: string, d?: any) => d) };
    const svc = new AuthService(prisma as any, { sign: jest.fn(), verify: jest.fn() } as any, config as any, {} as any);
    return { prisma, svc };
  };
  const admin = (over: any = {}) => ({ id: 'a1', email: 'adm@x.tz', passwordHash: hash, tenantId: 't1', isActive: true, deletedAt: null, lockedUntil: null, failedLoginAttempts: 0, ...over });
  const outcome = async (p: Promise<unknown>) => {
    try { return (await p) === null ? 'null' : 'ok'; } catch (e: any) { return e.message === GENERIC_LOGIN_ERROR ? 'generic' : e.message; }
  };

  const cases: Array<[string, (pr: ReturnType<typeof makePrisma>) => void, (s: AuthService) => Promise<unknown>, string]> = [
    ['storefront: unknown email', () => {}, (s) => s.validateUser('nobody@x.tz', 'Wrong1pass', 't1', undefined, { customerOnly: true }), 'null'],
    ['storefront: known email, wrong password', (pr) => pr.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash, isActive: true }), (s) => s.validateUser('c@x.tz', 'Wrong1pass', 't1', undefined, { customerOnly: true }), 'null'],
    ['storefront (legacy, no audience): unknown everywhere', () => {}, (s) => s.validateUser('nobody@x.tz', 'Wrong1pass', 't1'), 'null'],
    ['storefront (legacy): customer wrong password, no admin', (pr) => pr.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: hash, isActive: true }), (s) => s.validateUser('c@x.tz', 'Wrong1pass', 't1'), 'null'],
    ['admin app: unknown email', () => {}, (s) => s.validateUser('nobody@x.tz', 'Wrong1pass', null), 'null'],
    ['admin app: known email, wrong password', (pr) => pr.adminUser.findUnique.mockResolvedValue(admin()), (s) => s.validateUser('adm@x.tz', 'Wrong1pass', null), 'null'],
    ['admin app: locked account', (pr) => pr.adminUser.findUnique.mockResolvedValue(admin({ lockedUntil: new Date(Date.now() + 60_000) })), (s) => s.validateUser('adm@x.tz', 'Wrong1pass', null), 'generic'],
    ['admin app: over the attempt cap', (pr) => { pr.adminUser.findUnique.mockResolvedValue(admin()); pr.adminUser.update.mockResolvedValueOnce({ failedLoginAttempts: 6 }); }, (s) => s.validateUser('adm@x.tz', 'Wrong1pass', null), 'generic'],
    ['platform: unknown email', () => {}, (s) => s.validatePlatformAdmin('nobody@x.tz', 'Wrong1pass'), 'null'],
    ['platform: known email, wrong password', (pr) => pr.platformAdmin.findUnique.mockResolvedValue(admin()), (s) => s.validatePlatformAdmin('adm@x.tz', 'Wrong1pass'), 'null'],
    ['platform: locked account', (pr) => pr.platformAdmin.findUnique.mockResolvedValue(admin({ lockedUntil: new Date(Date.now() + 60_000) })), (s) => s.validatePlatformAdmin('adm@x.tz', 'Wrong1pass'), 'generic'],
  ];

  it.each(cases)('%s → exactly one bcrypt comparison', async (_n, setup, call, want) => {
    const { prisma, svc } = make();
    setup(prisma);
    expect(await outcome(call(svc))).toBe(want);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the caller sees the same answer for unknown, wrong and locked (null → the strategy’s generic 401)', async () => {
    const answers = new Set<string>();
    for (const [, setup, call] of cases.filter(([n]) => n.startsWith('admin app'))) {
      const { prisma, svc } = make();
      setup(prisma);
      const o = await outcome(call(svc));
      answers.add(o === 'null' ? 'generic' : o); // LocalStrategy turns null into GENERIC_LOGIN_ERROR
    }
    expect([...answers]).toEqual(['generic']);
  });

  it('measured: an unknown email takes about as long as a wrong password (real cost-12 hashes)', async () => {
    spy.mockRestore();
    const real = await bcrypt.hash('Correct1pass', 12);
    const time = async (fn: () => Promise<unknown>) => { const t = process.hrtime.bigint(); await fn().catch(() => null); return Number(process.hrtime.bigint() - t) / 1e6; };
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[1];
    const unknown: number[] = []; const wrong: number[] = [];
    await make().svc.validateUser('warm@x.tz', 'Wrong1pass', null); // builds the dummy hash once
    for (let i = 0; i < 3; i++) {
      unknown.push(await time(() => make().svc.validateUser('nobody@x.tz', 'Wrong1pass', null)));
      const w = make();
      w.prisma.adminUser.findUnique.mockResolvedValue(admin({ passwordHash: real }));
      wrong.push(await time(() => w.svc.validateUser('adm@x.tz', 'Wrong1pass', null)));
    }
    const ratio = med(unknown) / med(wrong);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  }, 30_000);
});
