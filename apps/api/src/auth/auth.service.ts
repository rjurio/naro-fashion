import {
  Injectable,
  ConflictException,
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

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

  generateTokens(user: {
    id: string;
    email: string | null;
    tenantId?: string | null;
    isAdmin?: boolean;
    isPlatformAdmin?: boolean;
    role?: string;
  }) {
    const payload: Record<string, any> = { sub: user.id, email: user.email };
    if (user.tenantId) payload.tenantId = user.tenantId;
    if (user.isAdmin) payload.isAdmin = true;
    if (user.isPlatformAdmin) payload.isPlatformAdmin = true;
    if (user.role) payload.role = user.role;

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET', 'naro-secret-key'),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRES', '15m'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get(
        'JWT_REFRESH_SECRET',
        'naro-refresh-secret-key',
      ),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES', '7d'),
    });

    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get(
          'JWT_REFRESH_SECRET',
          'naro-refresh-secret-key',
        ),
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
    if (isAdmin) {
      const admin = await this.prisma.adminUser.findUnique({ where: { id: userId } });
      if (admin) {
        return this.prisma.adminUser.update({
          where: { id: userId },
          data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
          select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
        });
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
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
