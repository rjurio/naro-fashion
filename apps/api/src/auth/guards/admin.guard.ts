import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * AdminGuard ensures the request is from a tenant admin (AdminUser) or platform admin.
 * Use this on tenant-admin endpoints to keep customer JWTs out.
 * Apply AFTER JwtAuthGuard so request.user is populated.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.isAdmin && !user?.isPlatformAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
