import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  requireJwtSecret,
  isTokenTypeAllowed,
  isTokenVersionCurrent,
} from '../util/jwt-secrets';

interface JwtPayload {
  sub: string;
  email: string;
  tenantId?: string;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  role?: string;
  /** tokenVersion at issue time; missing on legacy tokens (treated as 0). */
  tv?: number;
  /** 'access' | 'refresh'; missing on legacy tokens. */
  typ?: string;
}

/**
 * Validates access tokens and re-loads the principal on every request.
 * Rejects: refresh tokens used as access tokens (`typ`), revoked tokens
 * (`tv` !== row.tokenVersion — bumped on logout / password change /
 * suspension), inactive or soft-deleted principals, and customers whose
 * tenant no longer matches the token.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => request?.cookies?.access_token,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret('JWT_SECRET', configService),
    });
  }

  async validate(payload: JwtPayload) {
    if (!isTokenTypeAllowed(payload, 'access')) {
      throw new UnauthorizedException('Invalid token type');
    }

    // Tier 1: Platform Admin
    if (payload.isPlatformAdmin) {
      const platformAdmin = await this.prisma.platformAdmin.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          tokenVersion: true,
        },
      });
      if (!platformAdmin || !platformAdmin.isActive) {
        throw new UnauthorizedException('Platform admin not found or inactive');
      }
      if (!isTokenVersionCurrent(payload, platformAdmin.tokenVersion)) {
        throw new UnauthorizedException('Session has been revoked');
      }
      const { tokenVersion: _tv, ...rest } = platformAdmin;
      return { ...rest, isPlatformAdmin: true };
    }

    // Tier 2: Tenant Admin
    if (payload.isAdmin) {
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
          isActive: true,
          deletedAt: true,
          tokenVersion: true,
        },
      });
      if (!admin || !admin.isActive || admin.deletedAt) {
        throw new UnauthorizedException('Admin user not found or inactive');
      }
      if (!isTokenVersionCurrent(payload, admin.tokenVersion)) {
        throw new UnauthorizedException('Session has been revoked');
      }
      const { tokenVersion: _tv, deletedAt: _d, ...rest } = admin;
      return { ...rest, isAdmin: true, tenantId: admin.tenantId };
    }

    // Tier 3: Customer
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        tenantId: true,
        isActive: true,
        tokenVersion: true,
      },
    });

    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account suspended');
      }
      if (!isTokenVersionCurrent(payload, user.tokenVersion)) {
        throw new UnauthorizedException('Session has been revoked');
      }
      // Tenant membership: the token's tenant must still be the user's tenant.
      if (payload.tenantId && user.tenantId !== payload.tenantId) {
        throw new UnauthorizedException('Tenant mismatch');
      }
      const { tokenVersion: _tv, isActive: _a, ...rest } = user;
      return { ...rest, tenantId: user.tenantId };
    }

    // Fallback: check AdminUser (backward compatibility for legacy tokens
    // issued without the isAdmin flag)
    const adminFallback = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        isActive: true,
        deletedAt: true,
        tokenVersion: true,
      },
    });
    if (
      adminFallback &&
      adminFallback.isActive &&
      !adminFallback.deletedAt &&
      isTokenVersionCurrent(payload, adminFallback.tokenVersion)
    ) {
      const { tokenVersion: _tv, deletedAt: _d, ...rest } = adminFallback;
      return { ...rest, isAdmin: true, tenantId: adminFallback.tenantId };
    }

    throw new UnauthorizedException('User not found');
  }
}
