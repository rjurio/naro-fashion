import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRES_AI_PERMISSION_KEY } from '../decorators/requires-ai-permission.decorator';
import {
  AI_PERMISSION_CODES,
  AiScopePermissionCode,
} from '../types/ai-permissions.types';

/**
 * AiPermissionGuard — Phase 3.0 update.
 *
 * Behaviour:
 *   - Always requires `ai-agent:use` (the base gate that was enforced in
 *     Phase 1 and Phase 2 — unchanged).
 *   - If the route (or controller class) carries
 *     `@RequiresAiPermission('ai-agent:read'|':write-drafts'|':approve')`,
 *     ALSO requires that scope permission. Composition rule: `:use` alone
 *     is no longer enough on annotated routes.
 *   - Routes WITHOUT the decorator keep their Phase 1/2 behaviour: only
 *     `:use` is required. This is the back-compat hinge for the Phase 3.0
 *     rollout — existing endpoints don't change.
 *
 * Platform admins bypass the entire check; they implicitly hold every
 * permission.
 *
 * One Prisma query per request — fetches the intersection of the user's
 * granted permission codes and the required set, then verifies all
 * required codes are present.
 */
@Injectable()
export class AiPermissionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    if (user.isPlatformAdmin) {
      return true;
    }

    const adminUserId = user.id;
    if (!adminUserId) {
      throw new ForbiddenException(
        'AI agent access requires an admin account',
      );
    }

    // Always require ai-agent:use. Optionally require the per-route scope
    // permission when @RequiresAiPermission(...) is present.
    const required: string[] = [AI_PERMISSION_CODES.USE];
    const scopePerm = this.reflector.getAllAndOverride<AiScopePermissionCode>(
      REQUIRES_AI_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (scopePerm) required.push(scopePerm);

    // Single round-trip: fetch the intersection of required ∩ user-granted.
    const granted = await this.prisma.permission.findMany({
      where: {
        code: { in: required },
        isActive: true,
        rolePermissions: {
          some: {
            role: {
              deletedAt: null,
              isActive: true,
              adminUsers: {
                some: { adminUserId },
              },
            },
          },
        },
      },
      select: { code: true },
    });

    const haveCodes = new Set(granted.map((g) => g.code));
    const missing = required.filter((c) => !haveCodes.has(c));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing AI permission(s): ${missing.join(', ')}. Ask a SUPER_ADMIN to grant them to your role.`,
      );
    }

    return true;
  }
}
