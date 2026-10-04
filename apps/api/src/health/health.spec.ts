import * as fs from 'fs';
import * as path from 'path';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { HealthController } from './health.controller';
import { isInternalLoopbackRequest } from './app-throttler.guard';
import { isSwaggerEnabled } from './swagger.util';

function res() {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => {
    r.statusCode = c;
    return r;
  });
  return r;
}

describe('GET /health', () => {
  it('returns ok + db ok when SELECT 1 succeeds', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    process.env.GIT_SHA = 'abc123';
    const r = res();
    const body = await new HealthController(prisma).check(r);
    expect(body).toMatchObject({ status: 'ok', db: 'ok', commit: 'abc123' });
    expect(typeof body.uptime).toBe('number');
    expect(r.status).not.toHaveBeenCalled();
    delete process.env.GIT_SHA;
  });

  it('returns 503 with db down when the DB is unreachable', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const r = res();
    const body = await new HealthController(prisma).check(r);
    expect(body.db).toBe('down');
    expect(body.commit).toBeNull();
    expect(r.statusCode).toBe(503);
  });

  it('is @Public and @SkipThrottle', () => {
    const handler = HealthController.prototype.check;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    const keys = Reflect.getMetadataKeys(handler).map(String);
    expect(keys.some((k) => /THROTTLER:SKIP/i.test(k))).toBe(true);
  });
});

describe('global rate limiting wiring', () => {
  const appModule = fs.readFileSync(path.join(__dirname, '..', 'app.module.ts'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8');

  it('registers the throttler guard as APP_GUARD', () => {
    expect(appModule).toMatch(/provide:\s*APP_GUARD,\s*useClass:\s*AppThrottlerGuard/);
  });

  it('main.ts trusts exactly one proxy hop and enables rawBody', () => {
    expect(main).toMatch(/app\.set\('trust proxy',\s*1\)/);
    expect(main).toMatch(/rawBody:\s*true/);
  });

  it('exempts only internal loopback calls without X-Forwarded-For', () => {
    expect(isInternalLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: {} })).toBe(true);
    expect(isInternalLoopbackRequest({ socket: { remoteAddress: '::1' }, headers: {} })).toBe(true);
    // Through nginx: loopback peer but XFF present → throttled normally.
    expect(
      isInternalLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '41.59.1.2' } }),
    ).toBe(false);
    expect(isInternalLoopbackRequest({ socket: { remoteAddress: '41.59.1.2' }, headers: {} })).toBe(false);
  });
});

describe('Swagger exposure', () => {
  it('is on in dev, off in production unless ENABLE_SWAGGER=true', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'development' } as any)).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'production' } as any)).toBe(false);
    expect(isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' } as any)).toBe(true);
  });
});
