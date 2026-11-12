import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller';
import {
  CREDENTIAL_LIMIT_KEY,
  CredentialAttemptGuard,
  FixedWindowLimiter,
} from './guards/credential-attempt.guard';

/**
 * P0d review: per-account sign-in limits must stop guessing WITHOUT letting
 * an attacker lock a real customer out, and without revealing which
 * accounts exist.
 */

const WINDOW = 15 * 60_000;
const p = AuthController.prototype as any;

function harness(method: string) {
  let now = 1_000_000;
  const guard: any = new CredentialAttemptGuard(new Reflector());
  guard.limiter = new FixedWindowLimiter(100_000, () => now);
  const cfg = Reflect.getMetadata(CREDENTIAL_LIMIT_KEY, p[method]);
  const handler = () => undefined;
  Reflect.defineMetadata(CREDENTIAL_LIMIT_KEY, cfg, handler);
  const attempt = (body: any, ip = '41.59.0.1', tenant = 't1'): 'OK' | 429 => {
    const ctx: any = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ body, ip, headers: { 'x-tenant-id': tenant } }) }),
    };
    try {
      guard.canActivate(ctx);
      return 'OK';
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) return 429;
      throw e;
    }
  };
  return { attempt, cfg, advance: (ms: number) => { now += ms; } };
}

describe('customer sign-in: attacker using someone else\'s email', () => {
  const victim = { email: 'jane@example.com', password: 'guess' };

  it('an attacker on one IP is stopped after 10 tries in 15 min …', () => {
    const { attempt } = harness('login');
    const results = Array.from({ length: 12 }, () => attempt(victim, '102.0.0.66'));
    expect(results.slice(0, 10).every((r) => r === 'OK')).toBe(true);
    expect(results.slice(10)).toEqual([429, 429]);
  });

  it('… while the real customer on their own IP can still sign in (no lockout from one attacker)', () => {
    const { attempt } = harness('login');
    for (let i = 0; i < 25; i++) attempt(victim, '102.0.0.66');
    expect(attempt({ email: 'jane@example.com', password: 'correct' }, '41.59.7.7')).toBe('OK');
  });

  it('case / spacing variants of the email share one key (no bypass by "JANE@example.com ")', () => {
    const { attempt } = harness('login');
    for (let i = 0; i < 10; i++) attempt({ email: i % 2 ? 'JANE@Example.com ' : ' jane@example.com' }, '102.0.0.66');
    expect(attempt(victim, '102.0.0.66')).toBe(429);
  });

  it('an attacker rotating IPs (or forging X-Forwarded-For) hits the per-account ceiling of 60 / 15 min', () => {
    const { attempt } = harness('login');
    let ok = 0;
    for (let i = 0; i < 100; i++) if (attempt(victim, `198.51.100.${i}`) === 'OK') ok += 1;
    expect(ok).toBe(60);
  });

  it('the documented residual: once a distributed attacker spends the ceiling, the customer waits out the window', () => {
    const { attempt, advance } = harness('login');
    for (let i = 0; i < 60; i++) attempt(victim, `198.51.100.${i}`);
    expect(attempt(victim, '41.59.7.7')).toBe(429);
    advance(WINDOW + 1);
    expect(attempt(victim, '41.59.7.7')).toBe('OK');
  });

  it('a request blocked by the strict tier does not use up the account ceiling', () => {
    const { attempt } = harness('login');
    for (let i = 0; i < 500; i++) attempt(victim, '102.0.0.66'); // 10 counted, 490 blocked at the IP tier
    let ok = 0;
    for (let i = 0; i < 60; i++) if (attempt(victim, `203.0.113.${i}`) === 'OK') ok += 1;
    expect(ok).toBe(50); // 60 − the 10 the attacker's IP actually spent
  });

  it('no enumeration: blocked responses are identical for existing and non-existent accounts (no lookup)', () => {
    const { attempt } = harness('login');
    const real = Array.from({ length: 11 }, () => attempt({ email: 'jane@example.com' }, '102.0.0.66'));
    const ghost = Array.from({ length: 11 }, () => attempt({ email: 'nobody-xyz@example.com' }, '102.0.0.66'));
    expect(real).toEqual(ghost);
  });

  it('other tenants are separate (same email in two shops)', () => {
    const { attempt } = harness('login');
    for (let i = 0; i < 10; i++) attempt(victim, '102.0.0.66', 't1');
    expect(attempt(victim, '102.0.0.66', 't2')).toBe('OK');
  });
});

describe('legitimate use stays within sensible limits', () => {
  it('a customer who mistypes a few times then signs in is never blocked', () => {
    const { attempt } = harness('login');
    const seq = Array.from({ length: 6 }, () => attempt({ email: 'amina@example.com' }, '41.59.3.3'));
    expect(seq.every((r) => r === 'OK')).toBe(true);
  });

  it('password reset: 5 requests per hour per email (email-bombing guard), a real user needs 1–2', () => {
    const { attempt, cfg } = harness('forgotPassword');
    expect(cfg).toMatchObject({ limit: 5, windowMs: 60 * 60_000 });
    expect([1, 2].map(() => attempt({ email: 'amina@example.com' }))).toEqual(['OK', 'OK']);
  });

  it('reset-password and 2FA verify are keyed by the (hashed) token — 10 tries per token', () => {
    const r = harness('resetPassword');
    const t = harness('verify2FA');
    expect(r.cfg).toMatchObject({ field: 'token', hash: true, limit: 10 });
    expect(t.cfg).toMatchObject({ field: 'challengeToken', hash: true, limit: 10 });
    expect(Array.from({ length: 3 }, () => t.attempt({ challengeToken: 'c1', code: '123456' })).every((x) => x === 'OK')).toBe(true);
  });

  it('platform login has the same two-tier protection', () => {
    const { cfg } = harness('platformLogin');
    expect(cfg).toMatchObject({ perClient: true, limit: 10, accountLimit: 60 });
  });
});
