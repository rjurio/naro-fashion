import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * True for requests the API makes to ITSELF over loopback — today that is
 * the ai-assistant tool loop, which calls `/api/v1/ai/*` on localhost:4000
 * with the operator's token. Without this exemption every tenant's AI tool
 * calls would share ONE 127.0.0.1 throttle bucket.
 *
 * Safe against spoofing: real client traffic always arrives through nginx,
 * which appends `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), so a
 * request with NO forwarded header AND a loopback socket peer can only
 * originate on the box itself. A client cannot remove a header nginx adds.
 */
export function isInternalLoopbackRequest(req: any): boolean {
  const peer: string | undefined = req?.socket?.remoteAddress;
  if (!peer || !LOOPBACK.has(peer)) return false;
  return !req?.headers?.['x-forwarded-for'];
}

/**
 * Global rate-limit guard (APP_GUARD in AppModule). Default bucket comes
 * from `ThrottlerModule.forRoot` (100 req/min per client IP). Client IP is
 * `req.ip`, which is the real client address because main.ts sets
 * `trust proxy = 1` (exactly one hop: nginx).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (isInternalLoopbackRequest(req)) return true;
    return super.shouldSkip(context);
  }
}
