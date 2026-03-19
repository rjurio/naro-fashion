import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * TenantInterceptor extracts the tenantId from the authenticated user or
 * the X-Tenant-Id header and attaches it to the request object.
 *
 * This interceptor should be registered globally so all controllers
 * have access to request.tenantId.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Priority: user's tenantId (from JWT) > X-Tenant-Id header
    if (!request.tenantId) {
      request.tenantId =
        request.user?.tenantId ||
        request.headers['x-tenant-id'] ||
        null;
    }

    return next.handle();
  }
}
