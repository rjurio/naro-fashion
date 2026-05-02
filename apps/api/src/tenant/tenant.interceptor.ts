import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { requireJwtSecret } from '../auth/util/jwt-secrets';

/**
 * TenantInterceptor extracts the tenantId from the authenticated user or
 * the X-Tenant-Id header and attaches it to the request object.
 *
 * Trust precedence:
 *   1. `req.user.tenantId` — JwtAuthGuard validated the token and the
 *      AuthN strategy already populated req.user. Trust unconditionally.
 *   2. A verifiable Bearer token in the Authorization header (covers
 *      `@Public()` routes where JwtAuthGuard short-circuits before
 *      `req.user` is populated). If a token verifies AND the X-Tenant-Id
 *      header disagrees with `payload.tenantId`, reject the request — the
 *      caller is trying to scope reads/writes to a tenant they don't own.
 *   3. The `X-Tenant-Id` header on its own (legitimate anonymous storefront
 *      use case — no token, just a tenant cookie).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    if (request.tenantId) return next.handle();

    // 1. JWT validated by JwtAuthGuard — req.user is the source of truth.
    if (request.user?.tenantId) {
      request.tenantId = request.user.tenantId;
      return next.handle();
    }

    const headerTenantId = request.headers?.['x-tenant-id'] || null;
    const authHeader = request.headers?.authorization;

    // 2. @Public() route with a Bearer token. Verify and cross-check.
    if (authHeader?.startsWith?.('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = this.jwtService.verify(token, {
          secret: requireJwtSecret('JWT_SECRET', this.configService),
        });
        if (payload?.tenantId) {
          if (headerTenantId && headerTenantId !== payload.tenantId) {
            throw new ForbiddenException(
              'X-Tenant-Id does not match authenticated tenant',
            );
          }
          request.tenantId = payload.tenantId;
          return next.handle();
        }
      } catch (err) {
        // Re-throw the cross-tenant rejection; swallow other verify errors
        // (expired/invalid tokens fall through to header-only handling).
        if (err instanceof ForbiddenException) throw err;
      }
    }

    // 3. Anonymous storefront — accept the header.
    request.tenantId = headerTenantId;
    return next.handle();
  }
}
