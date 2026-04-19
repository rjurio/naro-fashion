import { Injectable, Scope, Inject, BadRequestException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * TenantContext is a request-scoped injectable that provides the current tenantId.
 *
 * It extracts tenantId from:
 * 1. The authenticated user's JWT payload (user.tenantId)
 * 2. The X-Tenant-Id header (for unauthenticated storefront requests)
 * 3. The TenantGuard sets request.tenantId
 * 4. Fallback: decodes JWT from Authorization header (for @Public() endpoints called with a token)
 *
 * Usage in services:
 *   constructor(private readonly tenantContext: TenantContext) {}
 *   this.prisma.product.findMany({ where: { tenantId: this.tenantContext.id, ... } })
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Returns the current tenantId, or null for platform admins.
   */
  get id(): string | null {
    const req = this.request as any;
    const id = req.tenantId || req.user?.tenantId || req.headers?.['x-tenant-id'] || null;
    if (id) return id;

    // Fallback: decode JWT from Authorization header for @Public() endpoints
    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET', 'naro-secret-key'),
        });
        if (payload.tenantId) {
          req.tenantId = payload.tenantId;
          return payload.tenantId;
        }
      } catch {
        // Invalid token — ignore
      }
    }
    return null;
  }

  /**
   * Returns the tenantId or throws if not available.
   * Use this in tenant-scoped services that must always have a tenant.
   */
  get requireId(): string {
    const id = this.id;
    if (!id) {
      throw new BadRequestException(
        'Tenant context is required. Provide X-Tenant-Id header or a valid Authorization token.',
      );
    }
    return id;
  }

  /**
   * Whether the current request is from a platform admin (no tenant scope).
   */
  get isPlatformAdmin(): boolean {
    return !!(this.request as any).user?.isPlatformAdmin;
  }
}
