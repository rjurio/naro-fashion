import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const TWO_FA_REQUIRED = 'TWO_FA_REQUIRED';

/**
 * Owner rule (2026-11-12): a designated National ID reviewer must have
 * two-factor sign-in enabled. Applied AFTER PermissionGuard on every ID
 * review route (queue, approve, reject) and on the ID image route.
 *
 * Exempt: platform admins and SUPER_ADMIN (the owner holds review by role and
 * must not be locked out; enrolling is recommended separately). Everyone else
 * holding `id-verification:review` is refused 403 TWO_FA_REQUIRED until their
 * AdminUser.is2FAEnabled is true — read from the DB on each call, so turning
 * 2FA off takes effect immediately.
 */
@Injectable()
export class ReviewerTwoFactorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user) throw new ForbiddenException('Admin access required');
    if (user.isPlatformAdmin || user.role === 'SUPER_ADMIN') return true;
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { is2FAEnabled: true },
    });
    if (admin?.is2FAEnabled) return true;
    throw new ForbiddenException({
      statusCode: 403,
      code: TWO_FA_REQUIRED,
      message: 'Reviewing National IDs needs two-factor sign-in. Turn it on in your admin profile, then try again.',
    });
  }
}
