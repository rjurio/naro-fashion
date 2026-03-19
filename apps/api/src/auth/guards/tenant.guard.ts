import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TenantGuard ensures that:
 * 1. The request has a valid tenantId (from JWT or X-Tenant-Id header)
 * 2. The tenant is ACTIVE (not SUSPENDED or DEACTIVATED)
 *
 * Platform admins bypass this guard entirely.
 * Public endpoints that need tenant context get tenantId from X-Tenant-Id header.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Platform admins bypass tenant guard
    if (user?.isPlatformAdmin) {
      return true;
    }

    // Get tenantId from authenticated user or X-Tenant-Id header
    const tenantId = user?.tenantId || request.headers['x-tenant-id'];

    if (!tenantId) {
      throw new ForbiddenException('Tenant context required');
    }

    // Validate tenant is active
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });

    if (!tenant) {
      throw new ForbiddenException('Tenant not found');
    }

    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('Tenant account is suspended. Please contact support.');
    }

    if (tenant.status === 'DEACTIVATED') {
      throw new ForbiddenException('Tenant account is deactivated');
    }

    // Attach tenantId to request for downstream use
    request.tenantId = tenantId;

    return true;
  }
}
