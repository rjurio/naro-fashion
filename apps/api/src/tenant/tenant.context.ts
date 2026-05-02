import {
  Injectable,
  Scope,
  Inject,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { requireJwtSecret } from '../auth/util/jwt-secrets';

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
   *
   * Mirrors `TenantInterceptor`'s cross-check: if the caller supplies a
   * Bearer token AND an X-Tenant-Id header that disagree, refuse — they're
   * trying to scope to a tenant they don't own. This getter is defense in
   * depth for code paths that bypass the global interceptor (e.g. tests,
   * sub-requests).
   */
  get id(): string | null {
    const req = this.request as any;

    // 1. Already resolved by the interceptor.
    if (req.tenantId) return req.tenantId;

    // 2. JwtAuthGuard validated and populated req.user.
    if (req.user?.tenantId) {
      req.tenantId = req.user.tenantId;
      return req.user.tenantId;
    }

    const headerTenantId = req.headers?.['x-tenant-id'] || null;
    const authHeader = req.headers?.authorization;

    // 3. @Public() route with a Bearer token — verify and cross-check.
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const payload = this.jwtService.verify(token, {
          secret: requireJwtSecret('JWT_SECRET', this.configService),
        });
        if (payload?.tenantId) {
          if (headerTenantId && headerTenantId !== payload.tenantId) {
            throw new ForbiddenException(
              'X-Tenant-Id does not match authenticated tenant',
            );
          }
          req.tenantId = payload.tenantId;
          return payload.tenantId;
        }
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        // Invalid/expired token — ignore and fall through.
      }
    }

    // 4. Anonymous storefront — accept the header alone.
    return headerTenantId;
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
