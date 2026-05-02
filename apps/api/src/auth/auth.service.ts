import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDto } from './dto/register.dto';
import { requireJwtSecret } from './util/jwt-secrets';

// Setting keys used to override JWT lifetimes per-tenant via the CMS settings UI.
export const ACCESS_EXPIRES_SETTING_KEY = 'auth_access_token_expires';
export const REFRESH_EXPIRES_SETTING_KEY = 'auth_refresh_token_expires';

// Caps applied at the API + UI layer so an admin can't lock everyone out
// (or open a security hole) with absurd values.
export const MAX_ACCESS_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24h
export const MAX_REFRESH_EXPIRES_MS = 90 * 24 * 60 * 60 * 1000; // 90d
export const MIN_ACCESS_EXPIRES_MS = 30 * 1000; // 30s — anything shorter just thrashes the refresh endpoint

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

  async register(dto: RegisterDto, tenantId?: string) {
    // If tenantId provided, check uniqueness within tenant
    if (tenantId) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, tenantId },
      });
      if (existing) {
        throw new ConflictException('Email already registered');
      }
    } else {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email },
      });
      if (existing) {
        throw new ConflictException('Email already registered');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        tenantId: tenantId || undefined,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    return user;
  }

  async validateUser(email: string, password: string, tenantId?: string) {
    // Check regular User table first (scoped by tenant if provided)
    const userWhere: any = { email };
    if (tenantId) userWhere.tenantId = tenantId;

    const user = await this.prisma.user.findFirst({ where: userWhere });

    if (user && user.passwordHash) {
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (isValid) {
        const { passwordHash: _, ...result } = user;
        return result;
      }
    }

    // Check AdminUser table (globally unique email — no tenant filter needed)
    const admin = await this.prisma.adminUser.findUnique({
      where: { email },
    });

    // Account lockout check
    if (admin && admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException(`Account locked until ${admin.lockedUntil.toISOString()}`);
    }

    if (admin) {
      const isValid = await bcrypt.compare(password, admin.passwordHash);
      if (isValid) {
        // Reset failed attempts on successful login
        await this.prisma.adminUser.update({
          where: { email },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
        await this.prisma.loginAttempt.create({
          data: { email, isAdmin: true, success: true, tenantId: admin.tenantId },
        });
        const { passwordHash: _, ...result } = admin;
        return { ...result, isAdmin: true };
      } else {
        // Increment failed attempts
        const attempts = admin.failedLoginAttempts + 1;
        await this.prisma.adminUser.update({
          where: { email },
          data: {
            failedLoginAttempts: attempts,
            lockedUntil: attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null,
          },
        });
        await this.prisma.loginAttempt.create({
          data: { email, isAdmin: true, success: false, tenantId: admin.tenantId },
        });
      }
    }

    return null;
  }

  /**
   * Platform Admin login — separate from tenant auth
   */
  async validatePlatformAdmin(email: string, password: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email },
    });

    if (!admin || !admin.isActive) return null;

    const isValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isValid) return null;

    const { passwordHash: _, ...result } = admin;
    return { ...result, isPlatformAdmin: true };
  }

  async generateTokens(user: {
    id: string;
    email: string | null;
    tenantId?: string | null;
    isAdmin?: boolean;
    isPlatformAdmin?: boolean;
    role?: string;
  }): Promise<{ accessToken: string; refreshToken: string; accessExpiresIn: string; refreshExpiresIn: string }> {
    const payload: Record<string, any> = { sub: user.id, email: user.email };
    if (user.tenantId) payload.tenantId = user.tenantId;
    if (user.isAdmin) payload.isAdmin = true;
    if (user.isPlatformAdmin) payload.isPlatformAdmin = true;
    if (user.role) payload.role = user.role;

    const { access: accessExpiresIn, refresh: refreshExpiresIn } =
      await this.resolveTokenExpirations(user.tenantId);

    const accessToken = this.jwtService.sign(payload, {
      secret: requireJwtSecret('JWT_SECRET', this.configService),
      expiresIn: accessExpiresIn as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: requireJwtSecret('JWT_REFRESH_SECRET', this.configService),
      expiresIn: refreshExpiresIn as any,
    });

    return { accessToken, refreshToken, accessExpiresIn, refreshExpiresIn };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: requireJwtSecret('JWT_REFRESH_SECRET', this.configService),
      });

      // Platform admin refresh
      if (payload.isPlatformAdmin) {
        const admin = await this.prisma.platformAdmin.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, role: true },
        });
        if (!admin) throw new UnauthorizedException('Platform admin not found');
        return this.generateTokens({ ...admin, isPlatformAdmin: true });
      }

      // Tenant admin refresh
      if (payload.isAdmin) {
        const admin = await this.prisma.adminUser.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, role: true, tenantId: true },
        });
        if (!admin) throw new UnauthorizedException('Admin not found');
        return this.generateTokens({ ...admin, isAdmin: true });
      }

      // Customer refresh
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, tenantId: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
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
          createdAt: true,
        },
      });
      if (admin) return { ...admin, isPlatformAdmin: true };
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
          tenantId: true,
          createdAt: true,
        },
      });
      if (admin) {
        // Fetch enabled modules for this tenant
        let enabledModules: string[] = [];
        if (admin.tenantId) {
          const modules = await this.prisma.tenantModule.findMany({
            where: { tenantId: admin.tenantId, isEnabled: true },
            select: { moduleCode: true },
          });
          enabledModules = modules.map((m) => m.moduleCode);
        }
        return { ...admin, isAdmin: true, enabledModules };
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
    data: { firstName?: string; lastName?: string; phone?: string },
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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    isAdmin?: boolean,
  ) {
    let user: any;
    if (isAdmin) {
      user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    }
    if (!user) {
      user = await this.prisma.user.findUnique({ where: { id: userId } });
    }
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    if (isAdmin) {
      await this.prisma.adminUser.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });
    }

    return { message: 'Password changed successfully' };
  }

  async toggle2FA(userId: string, enabled: boolean) {
    return this.prisma.adminUser.update({
      where: { id: userId },
      data: { is2FAEnabled: enabled },
      select: { id: true, is2FAEnabled: true },
    });
  }

  async forgotPassword(email: string) {
    // Always return success to prevent email enumeration

    // Check AdminUser table
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (admin) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await this.prisma.adminUser.update({
        where: { email },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      const adminUrl = this.configService.get('ADMIN_URL', 'http://localhost:3001');
      const resetUrl = `${adminUrl}/reset-password?token=${rawToken}`;

      this.notifications
        .sendPasswordResetEmail(email, resetUrl)
        .catch((err) =>
          this.logger.error(`Failed to send password reset email: ${err?.message}`),
        );

      this.logger.log(`[PASSWORD RESET] Reset link generated for admin ${email}`);
      return { message: 'If this email exists, a password reset link has been sent.' };
    }

    // Check User (customer) table
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      const storefrontUrl = this.configService.get('STOREFRONT_URL', 'http://localhost:3000');
      const resetUrl = `${storefrontUrl}/auth/reset-password?token=${rawToken}`;

      this.notifications
        .sendPasswordResetEmail(email, resetUrl)
        .catch((err) =>
          this.logger.error(`Failed to send password reset email: ${err?.message}`),
        );

      this.logger.log(`[PASSWORD RESET] Reset link generated for customer ${email}`);
    }

    return { message: 'If this email exists, a password reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
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
        data: { passwordHash, passwordResetToken: null, passwordResetExpires: null, failedLoginAttempts: 0, lockedUntil: null },
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
        data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
      });
      return { message: 'Password reset successfully' };
    }

    throw new UnauthorizedException('Invalid or expired reset token');
  }
}
