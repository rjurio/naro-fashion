import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  AuthService,
  GENERIC_LOGIN_ERROR,
  TWO_FA_ADMIN_ONLY_ERROR,
  TWO_FA_INVALID_CODE_ERROR,
  TWO_FA_NOT_CONFIGURED_ERROR,
  TWO_FA_USE_NEW_ENDPOINTS_ERROR,
  adminRequiresTwoFactor,
} from './auth.service';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './util/totp';
import {
  decryptTwoFaSecret,
  encryptTwoFaSecret,
  isEncryptedTwoFaSecret,
  resolveTwoFaKey,
} from './util/two-fa-crypto';
import { isTokenTypeAllowed } from './util/jwt-secrets';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from './util/recovery-codes';

/**
 * TOTP two-factor authentication for AdminUser:
 *  - RFC 6238 test vectors, base32, window, otpauth URI
 *  - AES-256-GCM secret encryption at rest
 *  - setup → enable → disable lifecycle (password + code, tokenVersion bump)
 *  - login challenge flow, shared lockout counter, replay protection,
 *    single-use challenges, typ confusion
 */

const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');

describe('TOTP util (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('SHA1 vector at T=%i → %s (8 digits)', (t, expected) => {
    expect(generateTotp(RFC_SEED, t, 8)).toBe(expected);
  });

  it('6-digit codes are the low 6 digits of the same HOTP value', () => {
    expect(generateTotp(RFC_SEED, 59, 6)).toBe('287082');
    expect(generateTotp(RFC_SEED, 1111111109, 6)).toBe('081804');
  });

  it('base32 round-trips and matches the canonical encoding of the RFC seed', () => {
    expect(base32Encode(RFC_SEED)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3t qojq gezdgnbvgy3tqojq').equals(RFC_SEED)).toBe(true);
    expect(() => base32Decode('not-base32!')).toThrow();
  });

  it('generates 20-byte secrets (32 base32 chars)', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it('verifyTotp accepts the current step ±1 and rejects ±2', () => {
    const secret = base32Encode(RFC_SEED);
    const nowMs = 1111111111 * 1000;
    const at = (offsetSteps: number) => generateTotp(RFC_SEED, 1111111111 + offsetSteps * 30);
    const current = Math.floor(1111111111 / 30);
    expect(verifyTotp(secret, at(0), { nowMs })).toBe(current);
    expect(verifyTotp(secret, at(-1), { nowMs })).toBe(current - 1);
    expect(verifyTotp(secret, at(1), { nowMs })).toBe(current + 1);
    expect(verifyTotp(secret, at(-2), { nowMs })).toBeNull();
    expect(verifyTotp(secret, at(2), { nowMs })).toBeNull();
  });

  it('verifyTotp rejects malformed input', () => {
    const secret = base32Encode(RFC_SEED);
    expect(verifyTotp(secret, '12345')).toBeNull();
    expect(verifyTotp(secret, 'abcdef')).toBeNull();
    expect(verifyTotp(secret, 123456 as any)).toBeNull();
    expect(verifyTotp(secret, { not: '' } as any)).toBeNull();
    expect(verifyTotp('!!!', '123456')).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const url = buildOtpauthUrl('Naro Fashion', 'admin@x.tz', 'ABC234');
    expect(url.startsWith('otpauth://totp/Naro%20Fashion:admin%40x.tz?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('secret')).toBe('ABC234');
    expect(params.get('issuer')).toBe('Naro Fashion');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

describe('2FA secret encryption (AES-256-GCM)', () => {
  const origEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });
  const cfg = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as any;

  it('round-trips and uses the v1:<iv>:<tag>:<ct> format', () => {
    const key = resolveTwoFaKey(cfg({ TWO_FA_ENCRYPTION_KEY: 'k'.repeat(64) }))!;
    const enc = encryptTwoFaSecret('JBSWY3DPEHPK3PXP', key);
    expect(enc.split(':')).toHaveLength(4);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(isEncryptedTwoFaSecret(enc)).toBe(true);
    expect(decryptTwoFaSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    // random IV → different ciphertext each time
    expect(encryptTwoFaSecret('JBSWY3DPEHPK3PXP', key)).not.toBe(enc);
  });

  it('rejects tampering, a wrong key and legacy plaintext values', () => {
    const key = resolveTwoFaKey(cfg({ TWO_FA_ENCRYPTION_KEY: 'k'.repeat(64) }))!;
    const other = resolveTwoFaKey(cfg({ TWO_FA_ENCRYPTION_KEY: 'z'.repeat(64) }))!;
    const enc = encryptTwoFaSecret('SECRET', key);
    const parts = enc.split(':');
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 1;
    expect(decryptTwoFaSecret([parts[0], parts[1], parts[2], flipped.toString('base64')].join(':'), key)).toBeNull();
    expect(decryptTwoFaSecret(enc, other)).toBeNull();
    expect(decryptTwoFaSecret('JBSWY3DPEHPK3PXP', key)).toBeNull();
    expect(isEncryptedTwoFaSecret('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(decryptTwoFaSecret(null, key)).toBeNull();
  });

  it('production without TWO_FA_ENCRYPTION_KEY → null (2FA refused, boot unaffected)', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveTwoFaKey(cfg({ JWT_SECRET: 'a'.repeat(64) }))).toBeNull();
    expect(resolveTwoFaKey(cfg({ TWO_FA_ENCRYPTION_KEY: 'short' }))).toBeNull();
    expect(resolveTwoFaKey(cfg({ TWO_FA_ENCRYPTION_KEY: 'k'.repeat(64) }))).toHaveLength(32);
  });

  it('non-production falls back to a JWT_SECRET-derived key', () => {
    process.env.NODE_ENV = 'test';
    const a = resolveTwoFaKey(cfg({ JWT_SECRET: 'a'.repeat(64) }))!;
    expect(a).toHaveLength(32);
    expect(resolveTwoFaKey(cfg({ JWT_SECRET: 'a'.repeat(64) }))!.equals(a)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service-level flow with a small stateful AdminUser fake
// ---------------------------------------------------------------------------

function applyData(row: any, data: any) {
  for (const [k, v] of Object.entries<any>(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('increment' in v) row[k] = (row[k] ?? 0) + v.increment;
      else if ('decrement' in v) row[k] = (row[k] ?? 0) - v.decrement;
      else if ('set' in v) row[k] = [...v.set];
    } else {
      row[k] = v;
    }
  }
}

function sameArray(a: any[], b: any[]) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Minimal stateful Prisma delegate over a single row (AdminUser or PlatformAdmin). */
function statefulDelegate(row: any) {
  const pick = (select?: Record<string, boolean>) => {
    if (!select) return { ...row, twoFARecoveryCodes: [...(row.twoFARecoveryCodes ?? [])] };
    const out: any = {};
    for (const k of Object.keys(select)) out[k] = Array.isArray(row[k]) ? [...row[k]] : row[k];
    return out;
  };
  return {
    findUnique: jest.fn(async ({ where, select }: any) =>
      where.id === row.id || where.email === row.email ? pick(select) : null,
    ),
    update: jest.fn(async ({ where, data, select }: any) => {
      if (where.id !== row.id) throw new Error('not found');
      applyData(row, data);
      return pick(select);
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.id !== row.id) return { count: 0 };
      if (where.failedLoginAttempts?.gt !== undefined && !(row.failedLoginAttempts > where.failedLoginAttempts.gt)) {
        return { count: 0 };
      }
      if (where.lockedUntil?.lte && !(row.lockedUntil && row.lockedUntil <= where.lockedUntil.lte)) {
        return { count: 0 };
      }
      if (where.twoFARecoveryCodes?.equals && !sameArray(row.twoFARecoveryCodes, where.twoFARecoveryCodes.equals)) {
        return { count: 0 };
      }
      applyData(row, data);
      return { count: 1 };
    }),
  };
}

function makeFakePrisma(admin: any, platform: any) {
  return {
    adminUser: statefulDelegate(admin),
    platformAdmin: statefulDelegate(platform),
    user: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Naro Fashion' }) },
    loginAttempt: { create: jest.fn() },
    adminActivityLog: { create: jest.fn() },
    siteSetting: { findMany: jest.fn().mockResolvedValue([]) },
    tenantModule: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('AuthService two-factor flows', () => {
  const env: Record<string, string> = {
    JWT_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    TWO_FA_ENCRYPTION_KEY: 'c'.repeat(64),
  };
  const config: any = { get: jest.fn((k: string, def?: any) => env[k] ?? def) };
  let hash: string;
  let prisma: ReturnType<typeof makeFakePrisma>;
  let jwt: JwtService;
  let service: AuthService;
  let admin: any;
  let platform: any;
  let lastRecoveryCodes: string[] = [];
  const principal = { id: 'a1', isAdmin: true };
  const platformPrincipal = { id: 'p1', isPlatformAdmin: true };

  beforeAll(async () => {
    hash = await bcrypt.hash('Correct1pass', 4);
  });

  beforeEach(() => {
    admin = {
      id: 'a1',
      email: 'adm@x.tz',
      passwordHash: hash,
      tenantId: 't1',
      role: 'SUPER_ADMIN',
      isActive: true,
      deletedAt: null,
      is2FAEnabled: false,
      twoFASecret: null,
      twoFARecoveryCodes: [],
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    platform = {
      id: 'p1',
      email: 'platform@naro.co.tz',
      passwordHash: hash,
      role: 'PLATFORM_ADMIN',
      isActive: true,
      is2FAEnabled: false,
      twoFASecret: null,
      twoFARecoveryCodes: [],
      tokenVersion: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    prisma = makeFakePrisma(admin, platform);
    jwt = new JwtService({});
    service = new AuthService(prisma as any, jwt, config, { sendPasswordResetEmail: jest.fn() } as any);
  });

  const codeFor = (secret: string, offsetSteps = 0) =>
    generateTotp(base32Decode(secret), Math.floor(Date.now() / 1000) + offsetSteps * 30);

  async function enrol(who: { id: string; isAdmin?: boolean; isPlatformAdmin?: boolean } = principal): Promise<string> {
    const { secret } = await service.setupTwoFactor(who, 'Correct1pass');
    // use the previous step so later tests can still use the current one
    const res = await service.enableTwoFactor(who, codeFor(secret, -1));
    lastRecoveryCodes = res.recoveryCodes;
    return secret;
  }

  describe('setup', () => {
    it('requires the current password (400, not 401)', async () => {
      await expect(service.setupTwoFactor(principal, 'wrong')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.adminUser.update).not.toHaveBeenCalled();
    });

    it('stores an encrypted PENDING secret and returns the otpauth URI + secret', async () => {
      const res = await service.setupTwoFactor(principal, 'Correct1pass');
      expect(res.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(res.otpauthUrl).toContain(`secret=${res.secret}`);
      expect(res.otpauthUrl).toContain('adm%40x.tz');
      expect(admin.is2FAEnabled).toBe(false);
      expect(isEncryptedTwoFaSecret(admin.twoFASecret)).toBe(true);
      expect(admin.twoFASecret).not.toContain(res.secret);
      const key = resolveTwoFaKey(config)!;
      expect(decryptTwoFaSecret(admin.twoFASecret, key)).toBe(res.secret);
    });

    it('is admin-only (customers get 400)', async () => {
      await expect(service.setupTwoFactor({ id: 'u1' }, 'x')).rejects.toThrow(TWO_FA_ADMIN_ONLY_ERROR);
    });

    it('refuses in production without TWO_FA_ENCRYPTION_KEY', async () => {
      const orig = process.env.NODE_ENV;
      const savedKey = env.TWO_FA_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'production';
      delete env.TWO_FA_ENCRYPTION_KEY;
      try {
        await expect(service.setupTwoFactor(principal, 'Correct1pass')).rejects.toThrow(TWO_FA_NOT_CONFIGURED_ERROR);
      } finally {
        process.env.NODE_ENV = orig;
        env.TWO_FA_ENCRYPTION_KEY = savedKey;
      }
    });

    it('refuses to re-enrol while enabled', async () => {
      await enrol();
      await expect(service.setupTwoFactor(principal, 'Correct1pass')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('enable', () => {
    it('rejects a wrong code and leaves 2FA off', async () => {
      await service.setupTwoFactor(principal, 'Correct1pass');
      await expect(service.enableTwoFactor(principal, '000000')).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      expect(admin.is2FAEnabled).toBe(false);
      expect(prisma.adminActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: '2FA_ENABLE_FAILED' }) }),
      );
    });

    it('requires setup first', async () => {
      await expect(service.enableTwoFactor(principal, '123456')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a valid code enables 2FA, bumps tokenVersion and audits', async () => {
      const { secret } = await service.setupTwoFactor(principal, 'Correct1pass');
      const res = await service.enableTwoFactor(principal, codeFor(secret));
      expect(admin.is2FAEnabled).toBe(true);
      expect(admin.tokenVersion).toBe(1);
      expect(res.principal).toMatchObject({ id: 'a1', isAdmin: true, tokenVersion: 1, tenantId: 't1' });
      expect(adminRequiresTwoFactor(admin)).toBe(true);
      expect(prisma.adminActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: '2FA_ENABLED', adminUserId: 'a1' }) }),
      );
    });
  });

  describe('disable', () => {
    it('requires BOTH password and code; bumps tokenVersion and clears the secret', async () => {
      const secret = await enrol();
      await expect(service.disableTwoFactor(principal, 'wrong', codeFor(secret))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.disableTwoFactor(principal, 'Correct1pass', '000000')).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      expect(admin.is2FAEnabled).toBe(true);

      const tvBefore = admin.tokenVersion;
      await service.disableTwoFactor(principal, 'Correct1pass', codeFor(secret));
      expect(admin.is2FAEnabled).toBe(false);
      expect(admin.twoFASecret).toBeNull();
      expect(admin.tokenVersion).toBe(tvBefore + 1);
      expect(prisma.adminActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: '2FA_DISABLED' }) }),
      );
    });

    it('legacy PATCH toggle cannot bypass the code requirement', async () => {
      await enrol();
      await expect(service.toggle2FA(principal, false, 'Correct1pass')).rejects.toThrow(TWO_FA_USE_NEW_ENDPOINTS_ERROR);
      expect(admin.is2FAEnabled).toBe(true);
    });
  });

  describe('replay protection', () => {
    it('the same code (time-step) is accepted only once', async () => {
      const { secret } = await service.setupTwoFactor(principal, 'Correct1pass');
      const code = codeFor(secret);
      await service.enableTwoFactor(principal, code);
      // same code immediately reused for disable → rejected
      await expect(service.disableTwoFactor(principal, 'Correct1pass', code)).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      // an OLDER step is rejected too
      await expect(service.disableTwoFactor(principal, 'Correct1pass', codeFor(secret, -1))).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      // the next step still works
      await expect(service.disableTwoFactor(principal, 'Correct1pass', codeFor(secret, 1))).resolves.toBeDefined();
    });
  });

  describe('login challenge flow', () => {
    it('correct password with 2FA enrolled does NOT reset earlier failures', async () => {
      await enrol();
      admin.failedLoginAttempts = 2;
      const res: any = await service.validateUser('adm@x.tz', 'Correct1pass', null);
      expect(res.isAdmin).toBe(true);
      expect(adminRequiresTwoFactor(res)).toBe(true);
      expect(admin.failedLoginAttempts).toBe(2); // reserved attempt given back, earlier failures kept
      expect(prisma.loginAttempt.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ success: true }) }),
      );
    });

    it('admins without 2FA (or with a stale legacy flag) still reset the counter as before', async () => {
      admin.failedLoginAttempts = 2;
      admin.is2FAEnabled = true; // legacy flag, no secret
      await service.validateUser('adm@x.tz', 'Correct1pass', null);
      expect(admin.failedLoginAttempts).toBe(0);
    });

    it('challenge token is short-lived, typed and carries no tenant/admin claims', async () => {
      await enrol();
      const token = service.issueTwoFactorChallenge(admin);
      const payload: any = jwt.decode(token);
      expect(payload.typ).toBe('2fa_challenge');
      expect(payload.sub).toBe('a1');
      expect(payload.tv).toBe(admin.tokenVersion);
      expect(payload.tenantId).toBeUndefined();
      expect(payload.isAdmin).toBeUndefined();
      expect(payload.exp - payload.iat).toBe(300);
    });

    it('valid challenge + code → principal for normal tokens; counter reset; challenge single-use', async () => {
      const secret = await enrol();
      admin.failedLoginAttempts = 1;
      const token = service.issueTwoFactorChallenge(admin);
      const res: any = await service.verifyTwoFactorLogin(token, codeFor(secret), { ipAddress: '1.2.3.4' });
      expect(res).toMatchObject({ id: 'a1', isAdmin: true, tenantId: 't1', tokenVersion: admin.tokenVersion });
      expect(res.passwordHash).toBeUndefined();
      expect(admin.failedLoginAttempts).toBe(0);

      const tokens = await service.generateTokens(res);
      expect((jwt.decode(tokens.accessToken) as any).isAdmin).toBe(true);

      // reusing the same challenge (even with a fresh code) is rejected
      await expect(service.verifyTwoFactorLogin(token, codeFor(secret, 1))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('replayed code with a NEW challenge is rejected', async () => {
      const secret = await enrol();
      const code = codeFor(secret);
      await service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), code);
      await expect(
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), code),
      ).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
    });

    it('failed codes count toward the lockout; 5th failure locks the account', async () => {
      const secret = await enrol();
      const token = service.issueTwoFactorChallenge(admin);
      for (let i = 0; i < 5; i++) {
        await expect(service.verifyTwoFactorLogin(token, '000000')).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      }
      expect(admin.failedLoginAttempts).toBe(5);
      expect(admin.lockedUntil).toBeInstanceOf(Date);
      // locked: even the right code gets the generic error
      await expect(service.verifyTwoFactorLogin(token, codeFor(secret))).rejects.toThrow(GENERIC_LOGIN_ERROR);
      // and the password step is locked too
      await expect(service.validateUser('adm@x.tz', 'Correct1pass', null)).rejects.toThrow(GENERIC_LOGIN_ERROR);
      expect(prisma.adminActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: '2FA_VERIFY_FAILED' }) }),
      );
    });

    it('rejects an access token presented as a challenge (typ confusion)', async () => {
      const secret = await enrol();
      const { accessToken, refreshToken } = await service.generateTokens({ ...admin, isAdmin: true });
      await expect(service.verifyTwoFactorLogin(accessToken, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyTwoFactorLogin(refreshToken, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(admin.failedLoginAttempts).toBe(0);
    });

    it('rejects a challenge token presented as a refresh token / access typ', async () => {
      await enrol();
      const challenge = service.issueTwoFactorChallenge(admin);
      await expect(service.refreshTokens(challenge)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(isTokenTypeAllowed({ typ: '2fa_challenge' }, 'access')).toBe(false);
      expect(isTokenTypeAllowed({ typ: '2fa_challenge' }, 'refresh')).toBe(false);
      // logout must not treat it as an access token either
      await expect(service.revokeFromTokens(challenge)).resolves.toBe(false);
    });

    it('rejects a stale challenge after tokenVersion moved (e.g. password changed)', async () => {
      const secret = await enrol();
      const token = service.issueTwoFactorChallenge(admin);
      admin.tokenVersion += 1;
      await expect(service.verifyTwoFactorLogin(token, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired / forged challenge', async () => {
      const secret = await enrol();
      const forged = jwt.sign({ sub: 'a1', tv: admin.tokenVersion, typ: '2fa_challenge', jti: 'x' }, { secret: 'z'.repeat(48) });
      await expect(service.verifyTwoFactorLogin(forged, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      const expired = jwt.sign(
        { sub: 'a1', tv: admin.tokenVersion, typ: '2fa_challenge', jti: 'y', exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: env.JWT_SECRET },
      );
      await expect(service.verifyTwoFactorLogin(expired, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.verifyTwoFactorLogin({ not: '' } as any, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects verification once 2FA has been disabled', async () => {
      const secret = await enrol();
      const token = service.issueTwoFactorChallenge(admin);
      admin.is2FAEnabled = false;
      await expect(service.verifyTwoFactorLogin(token, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('recovery codes', () => {
    it('enable returns 10 one-time codes once; only sha256 hashes are stored', async () => {
      await enrol();
      expect(lastRecoveryCodes).toHaveLength(10);
      for (const c of lastRecoveryCodes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
      expect(new Set(lastRecoveryCodes).size).toBe(10);
      expect(admin.twoFARecoveryCodes).toHaveLength(10);
      const n = normalizeRecoveryCode(lastRecoveryCodes[0])!;
      expect(admin.twoFARecoveryCodes).toContain(hashRecoveryCode(n));
      expect(JSON.stringify(admin.twoFARecoveryCodes)).not.toContain(n);
    });

    it('util: normalisation, detection and generation', () => {
      expect(normalizeRecoveryCode(' abcde-fghij ')).toBe('ABCDEFGHIJ');
      expect(normalizeRecoveryCode('abcde-fgh23')).toBe('ABCDEFGH23');
      expect(normalizeRecoveryCode('01890-18900')).toBeNull(); // 0/1/8/9 are not base32
      expect(normalizeRecoveryCode('short')).toBeNull();
      expect(normalizeRecoveryCode({ not: '' })).toBeNull();
      expect(looksLikeRecoveryCode('123456')).toBe(false);
      expect(looksLikeRecoveryCode('ABCDE-FGH23')).toBe(true);
      const g = generateRecoveryCodes(3);
      expect(g.plain).toHaveLength(3);
      expect(g.hashes[0]).toBe(hashRecoveryCode(normalizeRecoveryCode(g.plain[0])!));
    });

    it('verify accepts a recovery code (any case / spacing), consumes it and audits 2FA_RECOVERY_USED', async () => {
      await enrol();
      const code = lastRecoveryCodes[3].toLowerCase().replace('-', ' ');
      const res: any = await service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), code);
      expect(res.isAdmin).toBe(true);
      expect(admin.twoFARecoveryCodes).toHaveLength(9);
      expect(prisma.adminActivityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: '2FA_RECOVERY_USED' }) }),
      );
      // second use is rejected (and counts as a failure)
      await expect(
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), lastRecoveryCodes[3]),
      ).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      expect(admin.failedLoginAttempts).toBe(1);
    });

    it('concurrent use of the same recovery code succeeds only once', async () => {
      await enrol();
      const code = lastRecoveryCodes[0];
      const results = await Promise.allSettled([
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), code),
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), code),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(admin.twoFARecoveryCodes).toHaveLength(9);
    });

    it('concurrent use of two DIFFERENT codes removes both (CAS never resurrects a used code)', async () => {
      await enrol();
      await Promise.all([
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), lastRecoveryCodes[1]),
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), lastRecoveryCodes[2]),
      ]);
      expect(admin.twoFARecoveryCodes).toHaveLength(8);
    });

    it('regenerate needs password + code and replaces every code', async () => {
      const secret = await enrol();
      const old = [...lastRecoveryCodes];
      await expect(service.regenerateRecoveryCodes(principal, 'wrong', codeFor(secret))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.regenerateRecoveryCodes(principal, 'Correct1pass', '000000')).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      const res = await service.regenerateRecoveryCodes(principal, 'Correct1pass', codeFor(secret));
      expect(res.recoveryCodes).toHaveLength(10);
      expect(res.recoveryCodes).not.toEqual(old);
      await expect(
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), old[0]),
      ).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      await expect(
        service.verifyTwoFactorLogin(service.issueTwoFactorChallenge(admin), res.recoveryCodes[0]),
      ).resolves.toBeDefined();
    });

    it('disable accepts a recovery code (lost device) and clears all codes', async () => {
      await enrol();
      await service.disableTwoFactor(principal, 'Correct1pass', lastRecoveryCodes[5]);
      expect(admin.is2FAEnabled).toBe(false);
      expect(admin.twoFARecoveryCodes).toEqual([]);
      expect(admin.twoFASecret).toBeNull();
    });
  });

  describe('platform admins', () => {
    it('setup / enable work for PlatformAdmin and bump its tokenVersion', async () => {
      await enrol(platformPrincipal);
      expect(platform.is2FAEnabled).toBe(true);
      expect(isEncryptedTwoFaSecret(platform.twoFASecret)).toBe(true);
      expect(platform.twoFARecoveryCodes).toHaveLength(10);
      expect(platform.tokenVersion).toBe(1);
      expect(admin.is2FAEnabled).toBe(false); // AdminUser untouched
      expect(prisma.adminActivityLog.create).not.toHaveBeenCalled(); // FK is AdminUser-only
    });

    it('password step defers the counter reset when 2FA is on', async () => {
      await enrol(platformPrincipal);
      platform.failedLoginAttempts = 2;
      const res: any = await service.validatePlatformAdmin('platform@naro.co.tz', 'Correct1pass');
      expect(res.isPlatformAdmin).toBe(true);
      expect(adminRequiresTwoFactor(res)).toBe(true);
      expect(platform.failedLoginAttempts).toBe(2);
    });

    it('challenge records the principal type; verify issues PLATFORM tokens', async () => {
      const secret = await enrol(platformPrincipal);
      const token = service.issueTwoFactorChallenge(platform, 'platform');
      expect((jwt.decode(token) as any).pt).toBe('platform');
      expect((jwt.decode(token) as any).isPlatformAdmin).toBeUndefined();
      const res: any = await service.verifyTwoFactorLogin(token, codeFor(secret));
      expect(res).toMatchObject({ id: 'p1', isPlatformAdmin: true });
      expect(res.isAdmin).toBeUndefined();
      expect(res.passwordHash).toBeUndefined();
      const tokens = await service.generateTokens(res);
      const access: any = jwt.decode(tokens.accessToken);
      expect(access.isPlatformAdmin).toBe(true);
      expect(access.tenantId).toBeUndefined();
      expect(access.tv).toBe(platform.tokenVersion);
    });

    it('a challenge for one principal type cannot be redeemed against the other table', async () => {
      const secret = await enrol(platformPrincipal);
      // same id space mismatch: platform row id under pt=admin → no AdminUser 'p1'
      const wrongType = service.issueTwoFactorChallenge(platform, 'admin');
      await expect(service.verifyTwoFactorLogin(wrongType, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
      const noPt = jwt.sign({ sub: 'p1', tv: platform.tokenVersion, typ: '2fa_challenge', jti: 'z' }, { secret: env.JWT_SECRET, expiresIn: '5m' });
      await expect(service.verifyTwoFactorLogin(noPt, codeFor(secret))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('platform failed codes lock the platform account', async () => {
      await enrol(platformPrincipal);
      const token = service.issueTwoFactorChallenge(platform, 'platform');
      for (let i = 0; i < 5; i++) {
        await expect(service.verifyTwoFactorLogin(token, '000000')).rejects.toThrow(TWO_FA_INVALID_CODE_ERROR);
      }
      expect(platform.lockedUntil).toBeInstanceOf(Date);
      await expect(service.validatePlatformAdmin('platform@naro.co.tz', 'Correct1pass')).rejects.toThrow(GENERIC_LOGIN_ERROR);
    });

    it('disable + recovery codes work for platform admins; profile reports state', async () => {
      const secret = await enrol(platformPrincipal);
      const p: any = await service.getProfile('p1', false, true);
      expect(p.is2FAEnabled).toBe(true);
      expect(p.twoFARecoveryCodesRemaining).toBe(10);
      expect(p.twoFASecret).toBeUndefined();
      expect(p.twoFARecoveryCodes).toBeUndefined();
      await service.regenerateRecoveryCodes(platformPrincipal, 'Correct1pass', codeFor(secret));
      await service.disableTwoFactor(platformPrincipal, 'Correct1pass', codeFor(secret, 1));
      expect(platform.is2FAEnabled).toBe(false);
      expect(platform.twoFARecoveryCodes).toEqual([]);
    });
  });

  describe('profile', () => {
    it('reports the effective 2FA state and never returns the secret', async () => {
      await enrol();
      const p: any = await service.getProfile('a1', true);
      expect(p.is2FAEnabled).toBe(true);
      expect(p.twoFASecret).toBeUndefined();
      admin.twoFASecret = null; // stale legacy flag only
      const p2: any = await service.getProfile('a1', true);
      expect(p2.is2FAEnabled).toBe(false);
    });
  });
});
