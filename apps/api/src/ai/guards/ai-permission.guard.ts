import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AiPermissionGuard requires the caller to hold the `ai-agent:use`
 * permission via at least one of their assigned roles. Apply AFTER
 * JwtAuthGuard + AdminGuard so `request.user` is populated with the
 * AdminUser id and the `isAdmin`/`isPlatformAdmin` flags.
 *
 * Platform admins bypass — they implicitly hold every permission.
 *
 * The lookup is one short query per request. Memoising it would only
 * matter at very high agent-traffic volumes; we'll add a tiny in-process
 * TTL cache in Phase 4 if needed.
 */
@Injectable()
export class AiPermissionGuard implements CanActivate {
  private static readonly REQUIRED_PERMISSION = 'ai-agent:use';

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    if (user.isPlatformAdmin) {
      return true;
    }

    const adminUserId = user.id ?? user.sub;
    if (!adminUserId) {
      throw new ForbiddenException('AI agent access requires an admin account');
    }

    const has = await this.prisma.adminUserRole.count({
      where: {
        adminUserId,
        role: {
          deletedAt: null,
          isActive: true,
          permissions: {
            some: {
              permission: {
                code: AiPermissionGuard.REQUIRED_PERMISSION,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (has === 0) {
      throw new ForbiddenException(
        `Missing permission: ${AiPermissionGuard.REQUIRED_PERMISSION}. Ask a SUPER_ADMIN to grant it to your role.`,
      );
    }

    return true;
  }
}
