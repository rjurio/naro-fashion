import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDto } from './dto/register.dto';
import {
  requireJwtSecret,
  isTokenTypeAllowed,
  isTokenVersionCurrent,
  TWO_FA_CHALLENGE_TYP,
} from './util/jwt-secrets';
import { buildOtpauthUrl, generateTotpSecret, verifyTotp, timeStep } from './util/totp';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from './util/recovery-codes';
import {
  decryptTwoFaSecret,
  encryptTwoFaSecret,
  isEncryptedTwoFaSecret,
  resolveTwoFaKey,
} from './util/two-fa-crypto';

// Setting keys used to override JWT lifetimes per-tenant via the CMS settings UI.
export const ACCESS_EXPIRES_SETTING_KEY = 'auth_access_token_expires';
export const REFRESH_EXPIRES_SETTING_KEY = 'auth_refresh_token_expires';

// Caps applied at the API + UI layer so an admin can't lock everyone out
// (or open a security hole) with absurd values.
export const MAX_ACCESS_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24h
export const MAX_REFRESH_EXPIRES_MS = 90 * 24 * 60 * 60 * 1000; // 90d
export const MIN_ACCESS_EXPIRES_MS = 30 * 1000; // 30s — anything shorter just thrashes the refresh endpoint

/**
 * One message for every failed login (unknown email, wrong password, locked
 * account, inactive admin). A distinct "locked" message would reveal that the
 * email belongs to an admin / platform admin.
 */
export const GENERIC_LOGIN_ERROR = 'Invalid credentials or account temporarily locked';
export const SUSPENDED_ACCOUNT_ERROR = 'This account has been suspended. Please contact support.';
/** Legacy `PATCH /auth/2fa` — enabling / disabling a real enrolment moved to dedicated endpoints. */
export const TWO_FA_USE_NEW_ENDPOINTS_ERROR =
  'Use POST /auth/2fa/setup + /auth/2fa/enable to turn on two-factor authentication, and POST /auth/2fa/disable (password + code) to turn it off';
export const TWO_FA_ADMIN_ONLY_ERROR = 'Two-factor authentication is available for admin accounts only';
export const TWO_FA_NOT_CONFIGURED_ERROR =
  'Two-factor authentication is not configured on this server. Ask the platform operator to set TWO_FA_ENCRYPTION_KEY.';
export const TWO_FA_INVALID_CODE_ERROR = 'Invalid or expired authentication code';
export const TWO_FA_CHALLENGE_INVALID_ERROR = 'Your sign-in attempt has expired. Please sign in again.';
export const TWO_FA_CHALLENGE_TTL = '5m';
const TWO_FA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

const INACTIVE_TENANT_STATUSES = new Set(['SUSPENDED', 'DEACTIVATED']);

/** Fields that must never leave the API in a login/profile response. */
const SENSITIVE_PRINCIPAL_FIELDS = [
  'passwordHash',
  'twoFASecret',
  'twoFARecoveryCodes',
  'passwordResetToken',
  'passwordResetExpires',
  'failedLoginAttempts',
  'lockedUntil',
  'tokenVersion',
  'googleId',
  'facebookId',
] as const;

export function toPublicPrincipal<T extends Record<string, any>>(principal: T): Partial<T> {
  if (!principal) return principal;
  const out: Record<string, any> = { ...principal };
  for (const f of SENSITIVE_PRINCIPAL_FIELDS) delete out[f];
  return out as Partial<T>;
}

/**
 * Credentials must be plain strings. The LocalAuthGuard runs BEFORE the
 * global ValidationPipe, so a body like `{"email":{"not":""}}` would
 * otherwise reach Prisma as an operator object (operator injection — matches
 * the first row of the table).
 */
export function isCredentialShapeValid(email: unknown, password: unknown): email is string {
  return (
    typeof email === 'string' &&
    typeof password === 'string' &&
    email.length > 0 &&
    email.length <= 254 &&
    password.length > 0 &&
    password.length <= 256
  );
}

/**
 * True when an AdminUser row has a REAL TOTP enrolment (flag on + an
 * encrypted secret). Legacy rows that only carry `is2FAEnabled=true` from the
 * old free toggle (no secret) are NOT challenged — they'd be locked out.
 */
export function adminRequiresTwoFactor(row: { is2FAEnabled?: boolean | null; twoFASecret?: string | null } | null | undefined): boolean {
  return !!row?.is2FAEnabled && isEncryptedTwoFaSecret(row?.twoFASecret);
}

/** Which principal table a 2FA operation targets. */
export type TwoFaKind = 'admin' | 'platform';

/** The AdminUser / PlatformAdmin columns the 2FA code touches (PlatformAdmin has no tenantId / deletedAt). */
interface TwoFaRow {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  tokenVersion: number;
  is2FAEnabled: boolean;
  twoFASecret: string | null;
  twoFARecoveryCodes: string[];
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  tenantId?: string | null;
  deletedAt?: Date | null;
}

export interface LoginMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthPrincipal {
  id: string;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
}

/**
 * Parse a duration string (e.g. "15m", "2h", "30d", "30s") into milliseconds.
 * Matches the format @nestjs/jwt's expiresIn already accepts so the same
 * string can drive both JWT signing and HTTP cookie maxAge.
 * Returns null if the input is invalid.
 */
export function parseDurationMs(input: string | null | undefined): number | null {
  if (!input || typeof input !== 'string') return null;
  const m = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return n * multipliers[unit];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // 30-second tenant-keyed cache so the SiteSetting lookup doesn't run on
  // every login. Empty string key = global (no tenant).
  private expiryCache = new Map<string, { access: string; refresh: string; at: number }>();
  private readonly EXPIRY_CACHE_TTL_MS = 30 * 1000;

  // TOTP replay protection: last accepted time-step per admin. A code (and
  // any code from an earlier step) can be used at most once. In-memory, so
  // it is per API process — fine for the single-instance PM2 deployment.
  private readonly lastTotpStep = new Map<string, number>();
  // Single-use 2FA challenge tokens (jti → expiry ms).
  private readonly usedChallenges = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Resolve the access/refresh token lifetimes for a given tenant.
   * Precedence: tenant SiteSetting > env var > hardcoded default.
   * Returns the duration strings (e.g. "15m", "7d") so they can be passed
   * directly to JwtService.sign() AND parsed for cookie maxAge.
   */
  async resolveTokenExpirations(tenantId?: string | null): Promise<{ access: string; refresh: string }> {
    const cacheKey = tenantId || '';
    const cached = this.expiryCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.EXPIRY_CACHE_TTL_MS) {
      return { access: cached.access, refresh: cached.refresh };
    }

    const envAccess = this.configService.get<string>('JWT_ACCESS_EXPIRES', '15m');
    const envRefresh = this.configService.get<string>('JWT_REFRESH_EXPIRES', '7d');

    let access = envAccess;
    let refresh = envRefresh;

    if (tenantId) {
      try {
        const settings = await this.prisma.siteSetting.findMany({
          where: {
            tenantId,
            key: { in: [ACCESS_EXPIRES_SETTING_KEY, REFRESH_EXPIRES_SETTING_KEY] },
          },
          select: { key: true, value: true },
        });
        for (const s of settings) {
          // Only honour the override if it parses cleanly — bad data falls back to env
          if (s.key === ACCESS_EXPIRES_SETTING_KEY && parseDurationMs(s.value)) access = s.value;
          if (s.key === REFRESH_EXPIRES_SETTING_KEY && parseDurationMs(s.value)) refresh = s.value;
        }
      } catch {
        // SiteSetting lookup failure must never block login — keep env defaults
      }
    }

    this.expiryCache.set(cacheKey, { access, refresh, at: Date.now() });
    return { access, refresh };
  }

  /** Drop cached expiries for a tenant — call this from settings update handlers. */
  invalidateExpiryCache(tenantId?: string | null) {
    this.expiryCache.delete(tenantId || '');
  }

  /**
   * Resolve a caller-supplied tenant id (X-Tenant-Id header / req.tenantId)
   * into a tenant that exists and is not SUSPENDED/DEACTIVATED. Returns null
   * for anything else, so a bogus header can never scope a customer lookup.
   */
  async resolveActiveTenantId(raw: unknown): Promise<string | null> {
    if (typeof raw !== 'string') return null;
    const id = raw.trim();
    if (!id || id.length > 64) return null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!tenant || INACTIVE_TENANT_STATUSES.has(tenant.status)) return null;
    return tenant.id;
  }

  async register(dto: RegisterDto, rawTenantId?: unknown) {
    // Customers are tenant-scoped (email unique per tenant). A tenant-less
    // User row would be orphaned from every storefront and could collide
    // across tenants, so registration REQUIRES a resolvable tenant.
    if (rawTenantId === undefined || rawTenantId === null || rawTenantId === '') {
      throw new BadRequestException(
        'Tenant context is required to register. Provide the X-Tenant-Id header.',
      );
    }
    const tenantId = await this.resolveActiveTenantId(rawTenantId);
    if (!tenantId) {
      throw new BadRequestException('Unknown or inactive store');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, tenantId },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: hashedPassword,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          tenantId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Email already registered');
      throw e;
    }
  }

  /**
   * Customer + tenant-admin login (POST /auth/login via LocalStrategy).
   *
   * - Customers are looked up ONLY within the resolved tenant
   *   (`{ email, tenantId }`); without a tenant no customer can log in.
   * - Admins are looked up globally (AdminUser.email is globally unique).
   * - Suspended customers (`isActive=false`) are rejected after a correct
   *   password; inactive / soft-deleted admins are rejected generically.
   */
  async validateUser(email: unknown, password: unknown, tenantId?: string | null, meta?: LoginMeta) {
    if (!isCredentialShapeValid(email, password)) return null;
    const pwd = password as string;

    if (tenantId) {
      const user = await this.prisma.user.findFirst({ where: { email, tenantId } });
      if (user && user.passwordHash && (await bcrypt.compare(pwd, user.passwordHash))) {
        if (!user.isActive) {
          throw new UnauthorizedException(SUSPENDED_ACCOUNT_ERROR);
        }
        const { passwordHash: _, ...result } = user;
        return result;
      }
    }

    // AdminUser — globally unique email, no tenant filter needed
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin) return null;

    // With TOTP enrolled, a correct password is only half a login: the
    // failed-attempt counter is NOT reset here (only after the code is
    // verified), so password + code guesses share one lockout budget.
    const ok = await this.verifyWithLockout('admin', admin, pwd, meta, {
      deferSuccess: adminRequiresTwoFactor(admin),
    });
    if (!ok) return null;

    if (!admin.isActive || admin.deletedAt) {
      await this.logLoginAttempt(email, false, admin.tenantId, meta);
      return null;
    }

    const { passwordHash: _, ...result } = admin;
    return { ...result, isAdmin: true };
  }

  /**
   * Platform Admin login — separate from tenant auth. Same lockout policy as
   * AdminUser (5 failures → 30 min) using PlatformAdmin.failedLoginAttempts /
   * lockedUntil, with LoginAttempt logging.
   */
  async validatePlatformAdmin(email: unknown, password: unknown, meta?: LoginMeta) {
    if (!isCredentialShapeValid(email, password)) return null;

    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin) return null;

    const ok = await this.verifyWithLockout('platform', admin, password as string, meta, {
      deferSuccess: adminRequiresTwoFactor(admin),
    });
    if (!ok) return null;

    if (!admin.isActive) {
      await this.logLoginAttempt(email, false, null, meta);
      return null;
    }

    const { passwordHash: _, ...result } = admin;
    return { ...result, isPlatformAdmin: true };
  }

  /**
   * Password check with an atomic, race-free lockout counter.
   *
   * The attempt is RESERVED (atomic `increment`) before bcrypt runs, and the
   * returned counter decides the outcome. N parallel requests therefore get
   * N distinct counter values — at most MAX_FAILED_LOGIN_ATTEMPTS of them are
   * allowed to try a password per lockout window, instead of all of them
   * reading the same stale `failedLoginAttempts` and racing past the lock.
   *
   * Throws the generic error while locked; returns false on a wrong password.
   */
  private async verifyWithLockout(
    kind: 'admin' | 'platform',
    row: { id: string; email: string; passwordHash: string; lockedUntil: Date | null; tenantId?: string | null },
    password: string,
    meta?: LoginMeta,
    opts: { deferSuccess?: boolean } = {},
  ): Promise<boolean> {
    const delegate: any = kind === 'admin' ? this.prisma.adminUser : this.prisma.platformAdmin;
    const tenantId = kind === 'admin' ? row.tenantId ?? null : null;
    const now = new Date();

    if (row.lockedUntil && row.lockedUntil > now) {
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    // A lock that has expired starts a fresh window. Conditional so a
    // concurrent request that just re-locked the account isn't undone.
    if (row.lockedUntil && row.lockedUntil <= now) {
      await delegate.updateMany({
        where: { id: row.id, lockedUntil: { lte: now } },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const reserved: { failedLoginAttempts: number } = await delegate.update({
      where: { id: row.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (reserved.failedLoginAttempts > MAX_FAILED_LOGIN_ATTEMPTS) {
      await delegate.update({
        where: { id: row.id },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const valid = await bcrypt.compare(password, row.passwordHash);
    if (!valid) {
      if (reserved.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await delegate.update({
          where: { id: row.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
        });
      }
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      return false;
    }

    if (opts.deferSuccess) {
      // Password OK but a second factor is pending: give back the reserved
      // attempt without clearing earlier failures (e.g. bad TOTP codes).
      await delegate.updateMany({
        where: { id: row.id, failedLoginAttempts: { gt: 0 } },
        data: { failedLoginAttempts: { decrement: 1 } },
      });
      return true;
    }

    await delegate.update({
      where: { id: row.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.logLoginAttempt(row.email, true, tenantId, meta);
    return true;
  }

  private async logLoginAttempt(email: string, success: boolean, tenantId: string | null | undefined, meta?: LoginMeta) {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          email,
          isAdmin: true,
          success,
          tenantId: tenantId ?? null,
          ipAddress: meta?.ipAddress ?? null,
          userAgent: meta?.userAgent ? String(meta.userAgent).slice(0, 500) : null,
        },
      });
    } catch (err: any) {
      // Audit logging must never block or reveal anything about a login.
      this.logger.warn(`Failed to record login attempt: ${err?.message}`);
    }
  }

  async generateTokens(user: {
    id: string;
    email: string | null;
    tenantId?: string | null;
    isAdmin?: boolean;
    isPlatformAdmin?: boolean;
    role?: string;
    tokenVersion?: number | null;
  }): Promise<{ accessToken: string; refreshToken: string; accessExpiresIn: string; refreshExpiresIn: string }> {
    const payload: Record<string, any> = { sub: user.id, email: user.email };
    if (user.tenantId) payload.tenantId = user.tenantId;
    if (user.isAdmin) payload.isAdmin = true;
    if (user.isPlatformAdmin) payload.isPlatformAdmin = true;
    if (user.role) payload.role = user.role;
    // Token version — bumped on logout / password change / suspension so
    // previously-issued tokens stop verifying (JwtStrategy + refreshTokens).
    payload.tv = user.tokenVersion ?? 0;

    const { access: accessExpiresIn, refresh: refreshExpiresIn } =
      await this.resolveTokenExpirations(user.tenantId);

    const accessToken = this.jwtService.sign(
      { ...payload, typ: 'access' },
      {
        secret: requireJwtSecret('JWT_SECRET', this.configService),
        expiresIn: accessExpiresIn as any,
      },
    );

    const refreshToken = this.jwtService.sign(
      { ...payload, typ: 'refresh' },
      {
        secret: requireJwtSecret('JWT_REFRESH_SECRET', this.configService),
        expiresIn: refreshExpiresIn as any,
      },
    );

    return { accessToken, refreshToken, accessExpiresIn, refreshExpiresIn };
  }

  async refreshTokens(refreshToken: unknown) {
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: requireJwtSecret('JWT_REFRESH_SECRET', this.configService),
      });

      if (!isTokenTypeAllowed(payload, 'refresh')) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Platform admin refresh
      if (payload.isPlatformAdmin) {
        const admin = await this.prisma.platformAdmin.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, role: true, isActive: true, tokenVersion: true },
        });
        if (!admin || !admin.isActive || !isTokenVersionCurrent(payload, admin.tokenVersion)) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        return this.generateTokens({ ...admin, isPlatformAdmin: true });
      }

      // Tenant admin refresh
      if (payload.isAdmin) {
        const admin = await this.prisma.adminUser.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, role: true, tenantId: true, isActive: true, deletedAt: true, tokenVersion: true },
        });
        if (!admin || !admin.isActive || admin.deletedAt || !isTokenVersionCurrent(payload, admin.tokenVersion)) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        return this.generateTokens({ ...admin, isAdmin: true });
      }

      // Customer refresh
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, tenantId: true, isActive: true, tokenVersion: true },
      });
      if (
        !user ||
        !user.isActive ||
        !isTokenVersionCurrent(payload, user.tokenVersion) ||
        (payload.tenantId && user.tenantId !== payload.tenantId)
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Revoke every outstanding access + refresh token for a principal by
   * bumping its tokenVersion.
   */
  async revokeSessions(principal: AuthPrincipal): Promise<void> {
    const data = { tokenVersion: { increment: 1 } };
    if (principal.isPlatformAdmin) {
      await this.prisma.platformAdmin.updateMany({ where: { id: principal.id }, data });
      return;
    }
    if (principal.isAdmin) {
      await this.prisma.adminUser.updateMany({ where: { id: principal.id }, data });
      return;
    }
    const res = await this.prisma.user.updateMany({ where: { id: principal.id }, data });
    if (res.count === 0) {
      // Legacy admin tokens without the isAdmin flag (JwtStrategy fallback)
      await this.prisma.adminUser.updateMany({ where: { id: principal.id }, data });
    }
  }

  /**
   * Logout helper: identify the caller from whichever token they present
   * (access token — signature checked, expiry ignored so an expired session
   * can still be revoked — or refresh token) and bump its tokenVersion.
   * Only bumps when the presented token is still current, so a stale token
   * can't be replayed to repeatedly sign the real user out.
   */
  async revokeFromTokens(accessToken?: unknown, refreshToken?: unknown): Promise<boolean> {
    const candidates: Array<{ token: unknown; secret: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'; typ: 'access' | 'refresh' }> = [
      { token: accessToken, secret: 'JWT_SECRET', typ: 'access' },
      { token: refreshToken, secret: 'JWT_REFRESH_SECRET', typ: 'refresh' },
    ];
    for (const c of candidates) {
      if (typeof c.token !== 'string' || !c.token) continue;
      let payload: any;
      try {
        payload = this.jwtService.verify(c.token, {
          secret: requireJwtSecret(c.secret, this.configService),
          ignoreExpiration: true,
        });
      } catch {
        continue;
      }
      if (!isTokenTypeAllowed(payload, c.typ) || typeof payload?.sub !== 'string') continue;

      const current = await this.currentTokenVersion(payload);
      if (current === null || !isTokenVersionCurrent(payload, current)) return false;

      await this.revokeSessions({
        id: payload.sub,
        isAdmin: !!payload.isAdmin,
        isPlatformAdmin: !!payload.isPlatformAdmin,
      });
      return true;
    }
    return false;
  }

  private async currentTokenVersion(payload: any): Promise<number | null> {
    const where = { id: payload.sub as string };
    const select = { tokenVersion: true } as const;
    if (payload.isPlatformAdmin) {
      return (await this.prisma.platformAdmin.findUnique({ where, select }))?.tokenVersion ?? null;
    }
    if (payload.isAdmin) {
      return (await this.prisma.adminUser.findUnique({ where, select }))?.tokenVersion ?? null;
    }
    const user = await this.prisma.user.findUnique({ where, select });
    if (user) return user.tokenVersion;
    return (await this.prisma.adminUser.findUnique({ where, select }))?.tokenVersion ?? null;
  }

  async getProfile(userId: string, isAdmin?: boolean, isPlatformAdmin?: boolean) {
    // Platform admin profile
    if (isPlatformAdmin) {
      const admin = await this.prisma.platformAdmin.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          is2FAEnabled: true,
          twoFASecret: true,
          twoFARecoveryCodes: true,
          createdAt: true,
        },
      });
      if (admin) {
        const { twoFASecret: _s, twoFARecoveryCodes: codes, ...adminRest } = admin;
        const is2FAEnabled = adminRequiresTwoFactor(admin);
        return {
          ...adminRest,
          is2FAEnabled,
          twoFARecoveryCodesRemaining: is2FAEnabled ? (codes ?? []).length : 0,
          isPlatformAdmin: true,
        };
      }
    }

    // Tenant admin profile
    if (isAdmin) {
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          is2FAEnabled: true,
          twoFASecret: true,
          twoFARecoveryCodes: true,
          tenantId: true,
          createdAt: true,
        },
      });
      if (admin) {
        // Report the EFFECTIVE state (flag + real encrypted enrolment); the
        // secret and recovery-code hashes never leave the API.
        const { twoFASecret: _secret, twoFARecoveryCodes: codes, ...adminRest } = admin;
        const is2FAEnabled = adminRequiresTwoFactor(admin);
        const twoFARecoveryCodesRemaining = is2FAEnabled ? (codes ?? []).length : 0;
        // Fetch enabled modules for this tenant
        let enabledModules: string[] = [];
        if (admin.tenantId) {
          const modules = await this.prisma.tenantModule.findMany({
            where: { tenantId: admin.tenantId, isEnabled: true },
            select: { moduleCode: true },
          });
          enabledModules = modules.map((m) => m.moduleCode);
        }
        return { ...adminRest, is2FAEnabled, twoFARecoveryCodesRemaining, isAdmin: true, enabledModules };
      }
    }

    // Customer profile
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        phone: true,
        tenantId: true,
        createdAt: true,
      },
    });

    if (user) return user;

    // Fallback: check AdminUser if not found in User table
    const adminFallback = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });
    if (adminFallback) return { ...adminFallback, isAdmin: true };

    return null;
  }

  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; phone?: string | null },
    isAdmin?: boolean,
  ) {
    const updateData: any = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.phone !== undefined) updateData.phone = data.phone || null;

    if (isAdmin) {
      const admin = await this.prisma.adminUser.findUnique({ where: { id: userId } });
      if (admin) {
        return this.prisma.adminUser.update({
          where: { id: userId },
          data: updateData,
          select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
        });
      }
      throw new NotFoundException('Admin user not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, firstName: true, lastName: true, phone: true },
    });
  }

  /**
   * Change own password. Bumps tokenVersion (revoking every other session)
   * and returns the refreshed principal so the controller can re-issue
   * tokens for the CURRENT session.
   */
  async changePassword(
    principal: AuthPrincipal,
    currentPassword: unknown,
    newPassword: string,
  ) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const kind: 'platform' | 'admin' | 'user' = principal.isPlatformAdmin
      ? 'platform'
      : principal.isAdmin
        ? 'admin'
        : 'user';
    const delegate: any =
      kind === 'platform' ? this.prisma.platformAdmin : kind === 'admin' ? this.prisma.adminUser : this.prisma.user;

    const row = await delegate.findUnique({ where: { id: principal.id } });
    if (!row || !row.passwordHash) {
      throw new UnauthorizedException('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, row.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const updated = await delegate.update({
      where: { id: principal.id },
      data: { passwordHash: hashedPassword, tokenVersion: { increment: 1 } },
    });

    const fresh: any = {
      id: updated.id,
      email: updated.email,
      tenantId: updated.tenantId ?? null,
      role: updated.role,
      tokenVersion: updated.tokenVersion,
    };
    if (kind === 'platform') fresh.isPlatformAdmin = true;
    if (kind === 'admin') fresh.isAdmin = true;
    return { message: 'Password changed successfully', principal: fresh };
  }

  /**
   * Legacy `PATCH /auth/2fa` (kept for backward compatibility).
   *  - enabling → 400 pointing at POST /auth/2fa/setup + /auth/2fa/enable
   *  - disabling a REAL enrolment → 400 pointing at POST /auth/2fa/disable
   *    (which also requires a current code)
   *  - disabling a stale legacy flag (is2FAEnabled=true, no encrypted
   *    secret) → still allowed with the current password, to clean it up.
   */
  async toggle2FA(principal: AuthPrincipal, enabled: boolean, currentPassword: unknown) {
    if (enabled) {
      throw new BadRequestException(TWO_FA_USE_NEW_ENDPOINTS_ERROR);
    }
    if (principal.isPlatformAdmin) {
      throw new BadRequestException(TWO_FA_USE_NEW_ENDPOINTS_ERROR);
    }
    if (!principal.isAdmin) {
      throw new BadRequestException(TWO_FA_ADMIN_ONLY_ERROR);
    }
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id: principal.id } });
    if (!admin) throw new NotFoundException('Admin user not found');
    if (adminRequiresTwoFactor(admin)) {
      throw new BadRequestException(TWO_FA_USE_NEW_ENDPOINTS_ERROR);
    }
    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    return this.prisma.adminUser.update({
      where: { id: principal.id },
      data: { is2FAEnabled: false, twoFASecret: null },
      select: { id: true, is2FAEnabled: true },
    });
  }

  // ===================================================================
  // TOTP two-factor authentication — AdminUser AND PlatformAdmin.
  // Same lifecycle for both: setup (pending secret) → enable (code; returns
  // recovery codes once) → login challenge → verify (TOTP or recovery code)
  // → disable / regenerate recovery codes (password + code).
  // ===================================================================

  private requireTwoFaKey(): Buffer {
    const key = resolveTwoFaKey(this.configService);
    if (!key) throw new BadRequestException(TWO_FA_NOT_CONFIGURED_ERROR);
    return key;
  }

  /** admin = tenant AdminUser, platform = PlatformAdmin; customers get 400. */
  private twoFaKindOf(principal: AuthPrincipal): TwoFaKind {
    if (principal?.isPlatformAdmin) return 'platform';
    if (principal?.isAdmin) return 'admin';
    throw new BadRequestException(TWO_FA_ADMIN_ONLY_ERROR);
  }

  private twoFaDelegate(kind: TwoFaKind): any {
    return kind === 'platform' ? this.prisma.platformAdmin : this.prisma.adminUser;
  }

  private async loadPrincipalForTwoFactor(kind: TwoFaKind, id: string): Promise<TwoFaRow> {
    const row = await this.twoFaDelegate(kind).findUnique({ where: { id } });
    if (!row || !row.isActive || (kind === 'admin' && row.deletedAt)) {
      throw new NotFoundException('Admin user not found');
    }
    return row;
  }

  private async assertPassword(passwordHash: string, currentPassword: unknown) {
    // 400 (not 401) so the admin client's refresh-on-401 doesn't replay it.
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 256) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (!(await bcrypt.compare(currentPassword, passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
  }

  /**
   * Check a TOTP code and consume its time-step (replay protection). Returns
   * false for a wrong code OR a code whose step was already used.
   */
  private checkAndConsumeTotp(replayKey: string, secretBase32: string, code: unknown, nowMs = Date.now()): boolean {
    const step = verifyTotp(secretBase32, code, { nowMs });
    if (step === null) return false;
    const last = this.lastTotpStep.get(replayKey);
    if (last !== undefined && step <= last) return false;
    this.lastTotpStep.set(replayKey, step);
    if (this.lastTotpStep.size > 5000) {
      const cutoff = timeStep(Math.floor(nowMs / 1000)) - 2;
      for (const [k, v] of this.lastTotpStep) if (v < cutoff) this.lastTotpStep.delete(k);
    }
    return true;
  }

  /**
   * Atomically remove one recovery code. Compare-and-swap on the WHOLE array
   * (`equals` the list we read) so two concurrent requests can never both
   * consume the same code, nor resurrect a code another request just removed.
   */
  private async consumeRecoveryCode(kind: TwoFaKind, id: string, code: unknown): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return false;
    const hash = hashRecoveryCode(normalized);
    const delegate = this.twoFaDelegate(kind);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await delegate.findUnique({ where: { id }, select: { twoFARecoveryCodes: true } });
      const current: string[] = Array.isArray(row?.twoFARecoveryCodes) ? row.twoFARecoveryCodes : [];
      if (!current.includes(hash)) return false;
      const res = await delegate.updateMany({
        where: { id, twoFARecoveryCodes: { equals: current } },
        data: { twoFARecoveryCodes: { set: current.filter((h) => h !== hash) } },
      });
      if (res.count === 1) return true;
    }
    return false;
  }

  /**
   * Second-factor check used by verify / disable / regenerate: a 6-digit
   * TOTP code (replay-protected) or a one-time recovery code.
   */
  private async checkSecondFactor(
    kind: TwoFaKind,
    row: TwoFaRow,
    secret: string,
    code: unknown,
  ): Promise<'totp' | 'recovery' | null> {
    if (looksLikeRecoveryCode(code)) {
      return (await this.consumeRecoveryCode(kind, row.id, code)) ? 'recovery' : null;
    }
    return this.checkAndConsumeTotp(`${kind}:${row.id}`, secret, code) ? 'totp' : null;
  }

  private decryptOrFail(stored: string | null): string {
    const key = resolveTwoFaKey(this.configService);
    const plain = key ? decryptTwoFaSecret(stored, key) : null;
    if (!plain) {
      this.logger.error(
        '2FA secret could not be decrypted — TWO_FA_ENCRYPTION_KEY missing or changed since enrolment',
      );
      throw new ServiceUnavailableException('Two-factor verification is temporarily unavailable. Contact the platform operator.');
    }
    return plain;
  }

  private async auditTwoFactor(
    kind: TwoFaKind,
    row: { id: string; email?: string; tenantId?: string | null },
    action: string,
    meta?: LoginMeta,
    details?: Record<string, any>,
  ) {
    // AdminActivityLog.adminUserId is an FK to AdminUser, so platform-admin
    // events go to the application log instead.
    if (kind === 'platform') {
      this.logger.log(`[2FA] ${action} platformAdmin=${row.id} ip=${meta?.ipAddress ?? '-'}${details ? ` ${JSON.stringify(details)}` : ''}`);
      return;
    }
    // Written directly (AuditService is request-scoped and would make this
    // singleton — and the Passport strategies that use it — request-scoped).
    try {
      await this.prisma.adminActivityLog.create({
        data: {
          tenantId: row.tenantId ?? null,
          adminUserId: row.id,
          action,
          entity: 'AdminUser',
          entityId: row.id,
          details: details ?? undefined,
          ipAddress: meta?.ipAddress ?? null,
        },
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write 2FA audit log: ${err?.message}`);
    }
  }

  private freshPrincipal(kind: TwoFaKind, updated: any) {
    const base = { id: updated.id, email: updated.email, role: updated.role, tokenVersion: updated.tokenVersion };
    return kind === 'platform'
      ? { ...base, isPlatformAdmin: true as const }
      : { ...base, tenantId: updated.tenantId ?? null, isAdmin: true as const };
  }

  /**
   * Step 1 of enrolment: re-authenticate, generate a NEW secret and store it
   * encrypted as *pending* (is2FAEnabled stays false until a code confirms it).
   */
  async setupTwoFactor(principal: AuthPrincipal, currentPassword: unknown) {
    const kind = this.twoFaKindOf(principal);
    const key = this.requireTwoFaKey();
    const row = await this.loadPrincipalForTwoFactor(kind, principal.id);
    await this.assertPassword(row.passwordHash, currentPassword);
    if (adminRequiresTwoFactor(row)) {
      throw new BadRequestException('Two-factor authentication is already enabled. Disable it first to re-enrol.');
    }

    const secret = generateTotpSecret();
    await this.twoFaDelegate(kind).update({
      where: { id: row.id },
      data: { twoFASecret: encryptTwoFaSecret(secret, key), is2FAEnabled: false, twoFARecoveryCodes: { set: [] } },
    });

    let issuer = this.configService.get<string>('TWO_FA_ISSUER') || 'Naro Fashion';
    if (kind === 'platform') {
      issuer = `${issuer} Platform`;
    } else if (row.tenantId) {
      try {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { name: true } });
        if (tenant?.name) issuer = tenant.name;
      } catch {
        // cosmetic only
      }
    }
    issuer = issuer.replace(/:/g, '').trim() || 'Naro Fashion';

    return { otpauthUrl: buildOtpauthUrl(issuer, row.email, secret), secret, issuer };
  }

  /**
   * Step 2 of enrolment: confirm the pending secret with a TOTP code. Flips
   * is2FAEnabled, stores hashed recovery codes and bumps tokenVersion (every
   * other session dies); returns the plaintext recovery codes ONCE plus the
   * refreshed principal so the controller can re-issue THIS session.
   */
  async enableTwoFactor(principal: AuthPrincipal, code: unknown, meta?: LoginMeta) {
    const kind = this.twoFaKindOf(principal);
    this.requireTwoFaKey();
    const row = await this.loadPrincipalForTwoFactor(kind, principal.id);
    if (adminRequiresTwoFactor(row)) {
      throw new BadRequestException('Two-factor authentication is already enabled.');
    }
    if (!isEncryptedTwoFaSecret(row.twoFASecret)) {
      throw new BadRequestException('Start two-factor setup first (POST /auth/2fa/setup).');
    }
    const secret = this.decryptOrFail(row.twoFASecret);
    // Enrolment must prove the authenticator works — TOTP only.
    if (!this.checkAndConsumeTotp(`${kind}:${row.id}`, secret, code)) {
      await this.auditTwoFactor(kind, row, '2FA_ENABLE_FAILED', meta);
      throw new BadRequestException(TWO_FA_INVALID_CODE_ERROR);
    }

    const recovery = generateRecoveryCodes();
    const updated = await this.twoFaDelegate(kind).update({
      where: { id: row.id },
      data: {
        is2FAEnabled: true,
        twoFARecoveryCodes: { set: recovery.hashes },
        tokenVersion: { increment: 1 },
      },
    });
    await this.auditTwoFactor(kind, row, '2FA_ENABLED', meta);
    return {
      message: 'Two-factor authentication enabled. Other sessions have been signed out.',
      recoveryCodes: recovery.plain,
      principal: this.freshPrincipal(kind, updated),
    };
  }

  /** Turn 2FA off — requires BOTH the current password and a code (TOTP or recovery). */
  async disableTwoFactor(principal: AuthPrincipal, currentPassword: unknown, code: unknown, meta?: LoginMeta) {
    const kind = this.twoFaKindOf(principal);
    const row = await this.loadPrincipalForTwoFactor(kind, principal.id);
    if (!adminRequiresTwoFactor(row)) {
      throw new BadRequestException('Two-factor authentication is not enabled.');
    }
    await this.assertPassword(row.passwordHash, currentPassword);
    const secret = this.decryptOrFail(row.twoFASecret);
    const used = await this.checkSecondFactor(kind, row, secret, code);
    if (!used) {
      await this.auditTwoFactor(kind, row, '2FA_DISABLE_FAILED', meta);
      throw new BadRequestException(TWO_FA_INVALID_CODE_ERROR);
    }
    if (used === 'recovery') await this.auditTwoFactor(kind, row, '2FA_RECOVERY_USED', meta, { purpose: 'disable' });

    const updated = await this.twoFaDelegate(kind).update({
      where: { id: row.id },
      data: {
        is2FAEnabled: false,
        twoFASecret: null,
        twoFARecoveryCodes: { set: [] },
        tokenVersion: { increment: 1 },
      },
    });
    this.lastTotpStep.delete(`${kind}:${row.id}`);
    await this.auditTwoFactor(kind, row, '2FA_DISABLED', meta);
    return {
      message: 'Two-factor authentication disabled. Other sessions have been signed out.',
      principal: this.freshPrincipal(kind, updated),
    };
  }

  /** Replace all recovery codes (password + code). Returns the new plaintext set once. */
  async regenerateRecoveryCodes(principal: AuthPrincipal, currentPassword: unknown, code: unknown, meta?: LoginMeta) {
    const kind = this.twoFaKindOf(principal);
    const row = await this.loadPrincipalForTwoFactor(kind, principal.id);
    if (!adminRequiresTwoFactor(row)) {
      throw new BadRequestException('Two-factor authentication is not enabled.');
    }
    await this.assertPassword(row.passwordHash, currentPassword);
    const secret = this.decryptOrFail(row.twoFASecret);
    const used = await this.checkSecondFactor(kind, row, secret, code);
    if (!used) {
      await this.auditTwoFactor(kind, row, '2FA_RECOVERY_REGENERATE_FAILED', meta);
      throw new BadRequestException(TWO_FA_INVALID_CODE_ERROR);
    }
    if (used === 'recovery') await this.auditTwoFactor(kind, row, '2FA_RECOVERY_USED', meta, { purpose: 'regenerate' });

    const recovery = generateRecoveryCodes();
    await this.twoFaDelegate(kind).update({
      where: { id: row.id },
      data: { twoFARecoveryCodes: { set: recovery.hashes } },
    });
    await this.auditTwoFactor(kind, row, '2FA_RECOVERY_REGENERATED', meta);
    return { message: 'New recovery codes generated. Previous codes no longer work.', recoveryCodes: recovery.plain };
  }

  /**
   * Short-lived (5 min) token proving the password step succeeded. Signed
   * with JWT_SECRET but `typ: '2fa_challenge'` — JwtStrategy / refresh /
   * logout reject it because the explicit typ mismatches. Records the
   * principal type in `pt` ('admin' | 'platform') but carries no tenantId /
   * isAdmin / isPlatformAdmin claims, so tenant/module guards ignore it.
   */
  issueTwoFactorChallenge(row: { id: string; tokenVersion?: number | null }, kind: TwoFaKind = 'admin'): string {
    return this.jwtService.sign(
      {
        sub: row.id,
        tv: row.tokenVersion ?? 0,
        typ: TWO_FA_CHALLENGE_TYP,
        pt: kind,
        jti: crypto.randomBytes(16).toString('hex'),
      },
      { secret: requireJwtSecret('JWT_SECRET', this.configService), expiresIn: TWO_FA_CHALLENGE_TTL as any },
    );
  }

  /**
   * Step 2 of login. Validates the challenge token (typ, pt, tv, single use),
   * enforces the shared lockout counter (failed codes count like failed
   * passwords), checks a TOTP code (replay-protected) or a one-time recovery
   * code, and returns the principal to issue normal tokens for — an AdminUser
   * (isAdmin) or a PlatformAdmin (isPlatformAdmin), exactly like the
   * respective password login.
   */
  async verifyTwoFactorLogin(challengeToken: unknown, code: unknown, meta?: LoginMeta) {
    if (typeof challengeToken !== 'string' || !challengeToken) {
      throw new UnauthorizedException(TWO_FA_CHALLENGE_INVALID_ERROR);
    }
    let payload: any;
    try {
      payload = this.jwtService.verify(challengeToken, {
        secret: requireJwtSecret('JWT_SECRET', this.configService),
      });
    } catch {
      throw new UnauthorizedException(TWO_FA_CHALLENGE_INVALID_ERROR);
    }
    if (
      payload?.typ !== TWO_FA_CHALLENGE_TYP ||
      (payload.pt !== 'admin' && payload.pt !== 'platform') ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      throw new UnauthorizedException(TWO_FA_CHALLENGE_INVALID_ERROR);
    }
    const kind: TwoFaKind = payload.pt;
    this.pruneChallenges();
    if (this.usedChallenges.has(payload.jti)) {
      throw new UnauthorizedException(TWO_FA_CHALLENGE_INVALID_ERROR);
    }

    const delegate = this.twoFaDelegate(kind);
    const row: TwoFaRow | null = await delegate.findUnique({ where: { id: payload.sub } });
    if (
      !row ||
      !row.isActive ||
      (kind === 'admin' && row.deletedAt) ||
      !adminRequiresTwoFactor(row) ||
      !isTokenVersionCurrent(payload, row.tokenVersion)
    ) {
      throw new UnauthorizedException(TWO_FA_CHALLENGE_INVALID_ERROR);
    }
    const tenantId = kind === 'admin' ? row.tenantId ?? null : null;

    const now = new Date();
    if (row.lockedUntil && row.lockedUntil > now) {
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    // Decrypt BEFORE reserving an attempt: a server-side key problem must
    // not burn the admin's lockout budget.
    const secret = this.decryptOrFail(row.twoFASecret);

    const reserved: { failedLoginAttempts: number } = await delegate.update({
      where: { id: row.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (reserved.failedLoginAttempts > MAX_FAILED_LOGIN_ATTEMPTS) {
      await delegate.update({
        where: { id: row.id },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const used = await this.checkSecondFactor(kind, row, secret, code);
    if (!used) {
      if (reserved.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await delegate.update({
          where: { id: row.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
        });
      }
      await this.logLoginAttempt(row.email, false, tenantId, meta);
      await this.auditTwoFactor(kind, row, '2FA_VERIFY_FAILED', meta, { attempts: reserved.failedLoginAttempts });
      throw new UnauthorizedException(TWO_FA_INVALID_CODE_ERROR);
    }
    if (used === 'recovery') {
      const left = await delegate.findUnique({ where: { id: row.id }, select: { twoFARecoveryCodes: true } });
      await this.auditTwoFactor(kind, row, '2FA_RECOVERY_USED', meta, {
        purpose: 'login',
        remaining: Array.isArray(left?.twoFARecoveryCodes) ? left.twoFARecoveryCodes.length : undefined,
      });
    }

    this.usedChallenges.set(payload.jti, Date.now() + TWO_FA_CHALLENGE_TTL_MS);
    await delegate.update({
      where: { id: row.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.logLoginAttempt(row.email, true, tenantId, meta);

    const { passwordHash: _p, ...rest } = row;
    return kind === 'platform'
      ? { ...rest, isPlatformAdmin: true as const }
      : { ...rest, isAdmin: true as const };
  }

  private pruneChallenges() {
    const now = Date.now();
    for (const [jti, exp] of this.usedChallenges) if (exp < now) this.usedChallenges.delete(jti);
  }

  /**
   * Resolve the storefront origin for a tenant's customer-facing links:
   * Tenant.domain → https://<domain>, else the first origin listed in
   * STOREFRONT_URL (which may be comma-separated for multi-origin CORS).
   */
  async resolveStorefrontBaseUrl(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { domain: true },
    });
    const domain = tenant?.domain?.trim();
    if (domain) {
      const host = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (host) return `https://${host}`;
    }
    const raw = this.configService.get<string>('STOREFRONT_URL', 'http://localhost:3000') || 'http://localhost:3000';
    const first = raw.split(',')[0].trim().replace(/\/+$/, '');
    return first || 'http://localhost:3000';
  }

  /**
   * Request a password-reset email. Always returns the same message
   * (no enumeration).
   *
   * - With a tenant (storefront: X-Tenant-Id) → customer reset, looked up by
   *   `{ email, tenantId }`, link built from the tenant's own domain.
   * - Without a tenant (admin app) → AdminUser reset, link to ADMIN_URL.
   */
  async forgotPassword(email: unknown, rawTenantId?: unknown) {
    const generic = { message: 'If this email exists, a password reset link has been sent.' };
    if (typeof email !== 'string' || !email || email.length > 254) return generic;

    const hasTenant = typeof rawTenantId === 'string' && rawTenantId.length > 0;

    if (!hasTenant) {
      const admin = await this.prisma.adminUser.findUnique({ where: { email } });
      if (admin && admin.isActive && !admin.deletedAt) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        await this.prisma.adminUser.update({
          where: { id: admin.id },
          data: {
            passwordResetToken: hashedToken,
            passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
          },
        });

        const adminUrl = this.configService.get('ADMIN_URL', 'http://localhost:3001');
        const resetUrl = `${adminUrl}/reset-password?token=${rawToken}`;

        this.notifications
          .sendPasswordResetEmail(email, resetUrl, admin.tenantId)
          .catch((err) =>
            this.logger.error(`Failed to send password reset email: ${err?.message}`),
          );
        this.logger.log(`[PASSWORD RESET] Reset link generated for an admin account`);
      }
      return generic;
    }

    const tenantId = await this.resolveActiveTenantId(rawTenantId);
    if (!tenantId) return generic;

    const user = await this.prisma.user.findFirst({ where: { email, tenantId } });
    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      const storefrontUrl = await this.resolveStorefrontBaseUrl(tenantId);
      const resetUrl = `${storefrontUrl}/auth/reset-password?token=${rawToken}`;

      this.notifications
        .sendPasswordResetEmail(email, resetUrl, tenantId)
        .catch((err) =>
          this.logger.error(`Failed to send password reset email: ${err?.message}`),
        );
      this.logger.log(`[PASSWORD RESET] Reset link generated for a customer of tenant ${tenantId}`);
    }

    return generic;
  }

  async resetPassword(token: unknown, newPassword: string) {
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Check AdminUser table first
    const admin = await this.prisma.adminUser.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });
    if (admin) {
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
        },
      });
      return { message: 'Password reset successfully' };
    }

    // Check User (customer) table
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });
    if (user) {
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          tokenVersion: { increment: 1 },
        },
      });
      return { message: 'Password reset successfully' };
    }

    throw new UnauthorizedException('Invalid or expired reset token');
  }
}
