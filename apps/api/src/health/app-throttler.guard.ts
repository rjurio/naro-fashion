import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  INTERNAL_CALL_HEADER,
  isValidInternalCallToken,
  safeEqualString,
} from '../common/internal-call';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Header nginx would add (with TRUSTED_PROXY_SECRET) to prove a request came through it. */
export const PROXY_AUTH_HEADER = 'x-naro-proxy-auth';

const AI_PREFIX = '/api/v1/ai/';

/**
 * A request whose TCP peer is this machine and that carries no
 * `X-Forwarded-For` — i.e. it did NOT come through nginx (nginx always
 * appends XFF via `$proxy_add_x_forwarded_for`).
 *
 * NOTE: this is NOT proof of trust. The VPS is shared with other apps
 * (Jumuiya, sportflow, kiuruwi); any local process can open such a
 * connection. Until Nov 2026 every such request skipped rate limiting on
 * every route — including customer login, which has no account lockout.
 */
export function isInternalLoopbackRequest(req: any): boolean {
  const peer: string | undefined = req?.socket?.remoteAddress;
  if (!peer || !LOOPBACK.has(peer)) return false;
  return !req?.headers?.['x-forwarded-for'];
}

/**
 * The ONLY rate-limit exemption: the API's own ai-assistant tool loop.
 * Requires all three: loopback without XFF, an /api/v1/ai/ path, and the
 * per-process secret token (common/internal-call.ts). The AI chat endpoint
 * itself stays throttled (10/min), which bounds the tool loop.
 */
export function isAuthenticatedInternalAiCall(req: any): boolean {
  if (!isInternalLoopbackRequest(req)) return false;
  const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
  if (!path.startsWith(AI_PREFIX)) return false;
  return isValidInternalCallToken(req?.headers?.[INTERNAL_CALL_HEADER]);
}

/**
 * Rate-limit bucket for a request.
 *
 * - Default (no TRUSTED_PROXY_SECRET): through nginx → the client IP
 *   (`req.ip`; main.ts trusts exactly one proxy hop). Direct local callers
 *   (loopback, no XFF) all share ONE bucket, `loopback` — an overall ceiling
 *   for anything on the box that bypasses nginx.
 * - With TRUSTED_PROXY_SECRET (needs the matching nginx `proxy_set_header`,
 *   a reviewed infra change): X-Forwarded-For is believed ONLY when the
 *   request proves it came through nginx. A local process forging
 *   `X-Forwarded-For: <random>` (to get a fresh bucket per request) is keyed
 *   by its real socket peer instead.
 */
export function throttleTracker(req: any, env: NodeJS.ProcessEnv = process.env): string {
  const peer: string = req?.socket?.remoteAddress ?? 'unknown';
  const secret = env.TRUSTED_PROXY_SECRET;
  if (secret) {
    const proven = LOOPBACK.has(peer) && safeEqualString(req?.headers?.[PROXY_AUTH_HEADER], secret);
    return proven ? `ip:${req?.ip ?? peer}` : `peer:${peer}`;
  }
  if (isInternalLoopbackRequest(req)) return 'loopback';
  return `ip:${req?.ip ?? peer}`;
}

/**
 * Global rate-limit guard (APP_GUARD in AppModule). Default bucket comes
 * from `ThrottlerModule.forRoot` (100 req/min per client), tighter per-route
 * limits via @Throttle. See throttleTracker / isAuthenticatedInternalAiCall.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (isAuthenticatedInternalAiCall(req)) return true;
    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return throttleTracker(req);
  }
}
