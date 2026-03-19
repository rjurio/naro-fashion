import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

/**
 * TenantContext is a request-scoped injectable that provides the current tenantId.
 *
 * It extracts tenantId from:
 * 1. The authenticated user's JWT payload (user.tenantId)
 * 2. The X-Tenant-Id header (for unauthenticated storefront requests)
 * 3. The TenantGuard sets request.tenantId
 *
 * Usage in services:
 *   constructor(private readonly tenantContext: TenantContext) {}
 *   this.prisma.product.findMany({ where: { tenantId: this.tenantContext.id, ... } })
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  /**
   * Returns the current tenantId, or null for platform admins.
   */
  get id(): string | null {
    const req = this.request as any;
    return req.tenantId || req.user?.tenantId || req.headers?.['x-tenant-id'] || null;
  }

  /**
   * Returns the tenantId or throws if not available.
   * Use this in tenant-scoped services that must always have a tenant.
   */
  get requireId(): string {
    const id = this.id;
    if (!id) {
      throw new Error('Tenant context is required but not available');
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
