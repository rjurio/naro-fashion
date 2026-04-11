import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

/**
 * AuditService logs admin actions to the AdminActivityLog table.
 * Request-scoped so it can access the current request to extract adminUserId.
 *
 * Usage in services:
 *   constructor(private readonly auditService: AuditService) {}
 *   await this.auditService.log('CREATE', 'Product', product.id, { name: product.name });
 */
@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  /**
   * Log an admin action to the AdminActivityLog table.
   *
   * @param action - The action performed (CREATE, UPDATE, DELETE, RESTORE, etc.)
   * @param entity - The entity type (Product, Category, Order, etc.)
   * @param entityId - The ID of the entity (optional)
   * @param details - Additional details about the action (optional)
   * @param overrideAdminUserId - Override the admin user ID (optional, defaults to req.user.sub)
   */
  async log(
    action: string,
    entity: string,
    entityId?: string,
    details?: Record<string, any>,
    overrideAdminUserId?: string,
  ): Promise<void> {
    try {
      const req = this.request as any;
      const adminUserId = overrideAdminUserId || req.user?.sub;

      if (!adminUserId) {
        // No admin user — skip audit log (e.g., customer actions or system calls)
        return;
      }

      const tenantId = this.tenantContext.id;
      const ipAddress = req.ip || req.headers?.['x-forwarded-for'] || null;

      await this.prisma.adminActivityLog.create({
        data: {
          tenantId,
          adminUserId,
          action,
          entity,
          entityId,
          details: details || undefined,
          ipAddress,
        },
      });
    } catch {
      // Audit logging should never break the main flow
    }
  }
}
