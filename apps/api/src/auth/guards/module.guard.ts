import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRES_MODULE_KEY } from '../decorators/requires-module.decorator';

/**
 * ModuleGuard checks if a module is enabled for the current tenant.
 * Works with the @RequiresModule('moduleName') decorator on controllers.
 *
 * Platform admins bypass this guard.
 * Core modules (products, categories, orders, etc.) don't need this guard.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  // Simple in-memory cache: tenantId -> { modules: Set, expiry: number }
  private cache = new Map<string, { modules: Set<string>; expiry: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<string>(
      REQUIRES_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No module requirement — allow
    if (!requiredModule) return true;

    const request = context.switchToHttp().getRequest();

    // Platform admins bypass module checks
    if (request.user?.isPlatformAdmin) return true;

    let tenantId = request.tenantId || request.user?.tenantId || request.headers?.['x-tenant-id'];

    // Fallback: decode JWT from Authorization header for @Public() endpoints
    if (!tenantId) {
      const authHeader = request.headers?.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const secret = process.env.JWT_SECRET || 'naro-secret-key';
          const payload = jwt.verify(authHeader.substring(7), secret) as any;
          tenantId = payload.tenantId;
          if (tenantId) request.tenantId = tenantId;
        } catch {
          // Invalid token — ignore
        }
      }
    }

    if (!tenantId) {
      throw new ForbiddenException('Tenant context required for module access');
    }

    const enabledModules = await this.getEnabledModules(tenantId);

    if (!enabledModules.has(requiredModule)) {
      throw new ForbiddenException(
        `The "${requiredModule}" module is not enabled for your plan. Please upgrade your subscription.`,
      );
    }

    return true;
  }

  private async getEnabledModules(tenantId: string): Promise<Set<string>> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiry > Date.now()) {
      return cached.modules;
    }

    const modules = await this.prisma.tenantModule.findMany({
      where: { tenantId, isEnabled: true },
      select: { moduleCode: true },
    });

    const moduleSet = new Set(modules.map((m) => m.moduleCode));
    this.cache.set(tenantId, { modules: moduleSet, expiry: Date.now() + this.CACHE_TTL });

    return moduleSet;
  }
}
