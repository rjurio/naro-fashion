import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  tenantId?: string;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  role?: string;
}

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
      secretOrKey: configService.get<string>('JWT_SECRET', 'naro-secret-key'),
    });
  }

  async validate(payload: JwtPayload) {
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
        },
      });
      if (!platformAdmin || !platformAdmin.isActive) {
        throw new UnauthorizedException('Platform admin not found or inactive');
      }
      return { ...platformAdmin, isPlatformAdmin: true };
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
        },
      });
      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Admin user not found or inactive');
      }
      return { ...admin, isAdmin: true, tenantId: admin.tenantId };
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
      },
    });

    if (user) return { ...user, tenantId: user.tenantId };

    // Fallback: check AdminUser (backward compatibility)
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
      },
    });
    if (adminFallback && adminFallback.isActive) {
      return { ...adminFallback, isAdmin: true, tenantId: adminFallback.tenantId };
    }

    throw new UnauthorizedException('User not found');
  }
}
