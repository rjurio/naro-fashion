import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { Request } from 'express';
import { AuthService, GENERIC_LOGIN_ERROR, isCredentialShapeValid } from '../auth.service';

/**
 * POST /auth/login. Runs inside LocalAuthGuard — i.e. BEFORE the global
 * ValidationPipe and BEFORE TenantInterceptor — so:
 *  - credentials are type-checked here (Prisma operator-injection guard:
 *    `{"email":{"not":""}}` must never reach a `where` clause), and
 *  - the tenant is resolved here from `req.tenantId` (set by a global
 *    TenantGuard if present) or the X-Tenant-Id header, then validated
 *    against the Tenant table (exists + not suspended/deactivated) so the
 *    customer lookup is always `{ email, tenantId }`.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password', passReqToCallback: true });
  }

  async validate(req: Request, email: unknown, password: unknown) {
    if (!isCredentialShapeValid(email, password)) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const rawTenant = (req as any).tenantId ?? req.headers?.['x-tenant-id'];
    const tenantId = await this.authService.resolveActiveTenantId(rawTenant);

    const user = await this.authService.validateUser(email, password, tenantId, {
      ipAddress: req.ip ?? null,
      userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
    });
    if (!user) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    return user;
  }
}
