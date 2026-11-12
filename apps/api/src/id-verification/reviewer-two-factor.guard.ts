import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const TWO_FA_REQUIRED = 'TWO_FA_REQUIRED';

/**
 * `ID_REVIEW_2FA_ALL=true` ends the TEMPORARY exemption below: SUPER_ADMIN and
 * platform admins must then have 2FA too. Default off, so deploying this
 * changes nothing until the owner has enrolled and authorises turning it on
 * (set in all three .env files, then a guarded reload).
 */
export function idReview2faForAll(raw: string | undefined = process.env.ID_REVIEW_2FA_ALL): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/**
 * Owner rule (2026-11-12): a designated National ID reviewer must have
 * two-factor sign-in enabled. Applied AFTER PermissionGuard on every ID
 * review route (queue, approve, reject) and on the ID image route.
 *
 * TEMPORARY exemption: platform admins and SUPER_ADMIN (the owner holds review
 * by role and must not be locked out before enrolling). Removed by
 * ID_REVIEW_2FA_ALL=true. Everyone else holding `id-verification:review` is
 * refused 403 TWO_FA_REQUIRED until their is2FAEnabled is true — read from the
 * DB on each call, so turning 2FA off takes effect immediately.
 */
@Injectable()
export class ReviewerTwoFactorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user) throw new ForbiddenException('Admin access required');
    const all = idReview2faForAll();
    if (!all && (user.isPlatformAdmin || user.role === 'SUPER_ADMIN')) return true;

    const enrolled = user.isPlatformAdmin
      ? (await this.prisma.platformAdmin.findFirst({ where: { id: user.id }, select: { is2FAEnabled: true } }))?.is2FAEnabled
      : (await this.prisma.adminUser.findFirst({ where: { id: user.id, tenantId: user.tenantId ?? null, deletedAt: null }, select: { is2FAEnabled: true } }))?.is2FAEnabled;
    if (enrolled) return true;
    throw new ForbiddenException({
      statusCode: 403,
      code: TWO_FA_REQUIRED,
      message: 'Reviewing National IDs needs two-factor sign-in. Turn it on in your admin profile, then try again.',
    });
  }
}
