import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PROXY_AUTH_HEADER, isAuthenticatedInternalAiCall, throttleTracker } from './app-throttler.guard';
import { INTERNAL_CALL_HEADER, internalCallToken, isLoopbackUrl } from '../common/internal-call';
import {
  CREDENTIAL_LIMIT_KEY,
  CredentialAttemptGuard,
  FixedWindowLimiter,
  credentialKey,
} from '../auth/guards/credential-attempt.guard';
import { AuthController } from '../auth/auth.controller';

/**
 * P0d (Nov 2026): the blanket "loopback without X-Forwarded-For skips rate
 * limiting" exemption is gone. The VPS is shared with other apps, and
 * customers have no account lockout, so any local process could brute-force
 * customer logins unthrottled.
 */

const loopback = (url: string, headers: Record<string, string> = {}) => ({
  socket: { remoteAddress: '127.0.0.1' }, originalUrl: url, headers, ip: '127.0.0.1',
});
const viaNginx = (clientIp: string, headers: Record<string, string> = {}) => ({
  socket: { remoteAddress: '127.0.0.1' }, originalUrl: '/api/v1/products', ip: clientIp,
  headers: { 'x-forwarded-for': clientIp, ...headers },
});

describe('rate-limit exemption: only the authenticated in-process AI tool loop', () => {
  const token = internalCallToken();

  it('exempts loopback + /api/v1/ai/* + the per-process token', () => {
    expect(isAuthenticatedInternalAiCall(loopback('/api/v1/ai/products?limit=5', { [INTERNAL_CALL_HEADER]: token }))).toBe(true);
  });

  it('does NOT exempt loopback without the token (another app on the box)', () => {
    expect(isAuthenticatedInternalAiCall(loopback('/api/v1/ai/products'))).toBe(false);
    expect(isAuthenticatedInternalAiCall(loopback('/api/v1/ai/products', { [INTERNAL_CALL_HEADER]: 'x'.repeat(64) }))).toBe(false);
  });

  it('does NOT exempt sensitive routes even WITH the token (customer login, password reset)', () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/forgot-password', '/api/v1/auth/platform-login', '/api/v1/orders']) {
      expect(isAuthenticatedInternalAiCall(loopback(path, { [INTERNAL_CALL_HEADER]: token }))).toBe(false);
    }
  });

  it('does NOT exempt requests that came through nginx or from another host', () => {
    expect(isAuthenticatedInternalAiCall({ ...viaNginx('41.59.1.2', { [INTERNAL_CALL_HEADER]: token }), originalUrl: '/api/v1/ai/products' })).toBe(false);
    expect(isAuthenticatedInternalAiCall({ socket: { remoteAddress: '10.0.0.5' }, originalUrl: '/api/v1/ai/x', headers: { [INTERNAL_CALL_HEADER]: token } })).toBe(false);
  });

  it('the token is random per process and only sent to loopback URLs', () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isLoopbackUrl('http://localhost:4000/api/v1/ai/x')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:4000/api/v1/ai/x')).toBe(true);
    expect(isLoopbackUrl('https://api.narofashion.co.tz/api/v1/ai/x')).toBe(false);
  });

  it('the ai-assistant attaches the token only for loopback calls', () => {
    const svc = readFileSync(join(__dirname, '..', 'ai-assistant', 'ai-assistant.service.ts'), 'utf8');
    expect(svc).toMatch(/if \(isLoopbackUrl\(resolved\.toString\(\)\)\) \{\s*headers\[INTERNAL_CALL_HEADER\] = internalCallToken\(\);/);
  });
});

describe('throttleTracker: per-client buckets, local overall ceiling, spoof resistance', () => {
  it('through nginx → the real client IP (per-client limits kept)', () => {
    expect(throttleTracker(viaNginx('41.59.1.2'), {})).toBe('ip:41.59.1.2');
  });

  it('every direct local caller shares ONE bucket (overall ceiling for traffic bypassing nginx)', () => {
    expect(throttleTracker(loopback('/api/v1/auth/login'), {})).toBe('loopback');
    expect(throttleTracker({ socket: { remoteAddress: '::1' }, headers: {}, ip: '::1' }, {})).toBe('loopback');
  });

  describe('with TRUSTED_PROXY_SECRET (requires the matching nginx header — reviewed infra change)', () => {
    const env = { TRUSTED_PROXY_SECRET: 's3cret-proxy-value-0123456789' } as any;
    it('believes X-Forwarded-For only with proof the request came through nginx', () => {
      expect(throttleTracker(viaNginx('41.59.1.2', { [PROXY_AUTH_HEADER]: env.TRUSTED_PROXY_SECRET }), env)).toBe('ip:41.59.1.2');
    });
    it('a local process forging X-Forwarded-For gets its real peer bucket, not a fresh one per request', () => {
      const forged1 = viaNginx('1.2.3.4');
      const forged2 = viaNginx('5.6.7.8', { [PROXY_AUTH_HEADER]: 'wrong' });
      expect(throttleTracker(forged1, env)).toBe('peer:127.0.0.1');
      expect(throttleTracker(forged2, env)).toBe('peer:127.0.0.1');
    });
  });
});

describe('per-account credential limits (independent of IP)', () => {
  const cfg = { name: 'login', field: 'email', limit: 10, windowMs: 15 * 60_000 };

  it('keys by tenant + normalised email', () => {
    const k1 = credentialKey(cfg, { body: { email: ' Jane@Example.com ' }, headers: { 'x-tenant-id': 't1' } });
    const k2 = credentialKey(cfg, { body: { email: 'jane@example.com' }, headers: { 'x-tenant-id': 't1' } });
    expect(k1).toBe('login:t1:jane@example.com');
    expect(k1).toBe(k2);
    expect(credentialKey(cfg, { body: { email: 'jane@example.com' }, headers: { 'x-tenant-id': 't2' } })).not.toBe(k1);
  });

  it('hashes token-type identities (never stores reset tokens)', () => {
    const k = credentialKey({ ...cfg, name: 'reset-password', field: 'token', hash: true }, { body: { token: 'abc123' }, headers: {} });
    expect(k).toMatch(/^reset-password:-:[0-9a-f]{32}$/);
    expect(k).not.toContain('abc123');
  });

  it('blocks the 11th attempt on one account in the window, whatever IP it comes from; resets after', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(1000, () => now);
    const key = 'login:t1:jane@example.com';
    for (let i = 0; i < 10; i++) expect(limiter.hit(key, 10, 15 * 60_000)).toBe(true);
    expect(limiter.hit(key, 10, 15 * 60_000)).toBe(false);
    expect(limiter.hit('login:t1:other@example.com', 10, 15 * 60_000)).toBe(true); // other accounts unaffected
    now += 15 * 60_000 + 1;
    expect(limiter.hit(key, 10, 15 * 60_000)).toBe(true);
  });

  it('guard answers 429 TOO_MANY_ATTEMPTS once over the limit', () => {
    const reflector = new Reflector();
    const guard: any = new CredentialAttemptGuard(reflector);
    guard.limiter = new FixedWindowLimiter();
    const handler = () => undefined;
    Reflect.defineMetadata(CREDENTIAL_LIMIT_KEY, { ...cfg, limit: 2 }, handler);
    const ctx: any = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ body: { email: 'x@y.z' }, headers: { 'x-tenant-id': 't1' } }) }),
    };
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    let err: any;
    try { guard.canActivate(ctx); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('is wired on login, platform-login, 2FA verify, forgot- and reset-password', () => {
    const p = AuthController.prototype as any;
    const wired = ['login', 'platformLogin', 'verify2FA', 'forgotPassword', 'resetPassword'].map((m) => [m, Reflect.getMetadata(CREDENTIAL_LIMIT_KEY, p[m])?.name]);
    expect(wired).toEqual([
      ['login', 'login'], ['platformLogin', 'platform-login'], ['verify2FA', '2fa-verify'],
      ['forgotPassword', 'forgot-password'], ['resetPassword', 'reset-password'],
    ]);
  });

  it('on login it runs BEFORE LocalAuthGuard (the attempt counts before the password check)', () => {
    const guards = Reflect.getMetadata('__guards__', (AuthController.prototype as any).login).map((g: any) => g.name);
    expect(guards[0]).toBe('CredentialAttemptGuard');
    expect(guards).toContain('LocalAuthGuard');
  });
});
