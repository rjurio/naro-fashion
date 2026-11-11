import * as http from 'http';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AddressInfo } from 'net';
import { throttleTracker, isAuthenticatedInternalAiCall, PROXY_AUTH_HEADER } from './app-throttler.guard';
import { INTERNAL_CALL_HEADER, internalCallToken } from '../common/internal-call';

/**
 * P0d: TRUSTED_PROXY_SECRET integration, tested in isolation with the REAL
 * Express (the one Nest runs, `trust proxy` = 1 as in main.ts) and, when
 * available, a REAL nginx using the exact proxy block planned for
 * api.narofashion.co.tz (docs/OPS/PROXY_SECRET.md).
 *
 * The nginx part runs in the separate CI workflow
 * `.github/workflows/proxy-secret-test.yml` (REQUIRE_NGINX=1 makes a missing
 * nginx a failure there). Locally without nginx it is skipped, loudly.
 * Nothing here touches production nginx or env files.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require(require.resolve('express', { paths: [require.resolve('@nestjs/platform-express')] }));

const SECRET = 'a3f1c0de'.repeat(6); // 48 hex chars, test-only

interface Seen {
  ip: string;
  xff: string | null;
  authValues: string[];
  withSecret: string;
  withoutSecret: string;
  aiExempt: boolean;
}

function startApp(): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.set('trust proxy', 1); // as apps/api/src/main.ts
  app.use((req: any, res: any) => {
    const authValues: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === PROXY_AUTH_HEADER) authValues.push(req.rawHeaders[i + 1]);
    }
    const seen: Seen = {
      ip: req.ip,
      xff: req.headers['x-forwarded-for'] ?? null,
      authValues,
      withSecret: throttleTracker(req, { TRUSTED_PROXY_SECRET: SECRET } as any),
      withoutSecret: throttleTracker(req, {} as any),
      aiExempt: isAuthenticatedInternalAiCall(req),
    };
    res.json(seen);
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function get(port: number, path: string, headers: Record<string, string> = {}, localAddress?: string): Promise<Seen> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers, localAddress, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('proxy secret: direct callers on the box (no nginx in the path)', () => {
  let app: { server: http.Server; port: number };
  beforeAll(async () => { app = await startApp(); });
  afterAll(() => new Promise<void>((r) => app.server.close(() => r())));

  it('today (secret OFF): a local caller with no XFF lands in the shared `loopback` bucket', async () => {
    expect((await get(app.port, '/api/v1/products')).withoutSecret).toBe('loopback');
  });

  it('today (secret OFF): a local caller FORGING X-Forwarded-For picks its own bucket (the documented T2 residual)', async () => {
    const s = await get(app.port, '/api/v1/auth/login', { 'X-Forwarded-For': '9.9.9.9' });
    expect(s.withoutSecret).toBe('ip:9.9.9.9');
  });

  it('secret ON: forged XFF without the secret → keyed by the real socket peer', async () => {
    const s = await get(app.port, '/api/v1/auth/login', { 'X-Forwarded-For': '9.9.9.9' });
    expect(s.withSecret).toBe('peer:127.0.0.1');
  });

  it('secret ON: forged XFF with a WRONG secret → still the real peer', async () => {
    const s = await get(app.port, '/api/v1/auth/login', { 'X-Forwarded-For': '9.9.9.9', [PROXY_AUTH_HEADER]: 'guess'.repeat(10) });
    expect(s.withSecret).toBe('peer:127.0.0.1');
  });

  it('secret ON: anyone who KNOWS the secret can choose a bucket — so it must be readable by root only', async () => {
    const s = await get(app.port, '/api/v1/auth/login', { 'X-Forwarded-For': '9.9.9.9', [PROXY_AUTH_HEADER]: SECRET });
    expect(s.withSecret).toBe('ip:9.9.9.9');
  });

  it('the AI exemption needs loopback + no XFF + an /ai/ path + the in-process token', async () => {
    const token = internalCallToken();
    expect((await get(app.port, '/api/v1/ai/products', { [INTERNAL_CALL_HEADER]: token })).aiExempt).toBe(true);
    expect((await get(app.port, '/api/v1/ai/products', { [INTERNAL_CALL_HEADER]: 'f'.repeat(64) })).aiExempt).toBe(false);
    expect((await get(app.port, '/api/v1/auth/login', { [INTERNAL_CALL_HEADER]: token })).aiExempt).toBe(false);
    expect((await get(app.port, '/api/v1/ai/products', { [INTERNAL_CALL_HEADER]: token, 'X-Forwarded-For': '1.2.3.4' })).aiExempt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real nginx
// ---------------------------------------------------------------------------
const nginxBin = process.env.NGINX_BIN || 'nginx';
const haveNginx = process.platform !== 'win32' && spawnSync(nginxBin, ['-v']).status === 0;
if (!haveNginx && process.env.REQUIRE_NGINX === '1') {
  throw new Error('REQUIRE_NGINX=1 but nginx is not available');
}
if (!haveNginx) {
  // eslint-disable-next-line no-console
  console.warn('[proxy-secret.nginx.spec] nginx not found: the real-nginx tests are SKIPPED here (they run in proxy-secret-test.yml).');
}

(haveNginx ? describe : describe.skip)('proxy secret through a REAL nginx (the planned api.narofashion.co.tz block)', () => {
  let app: { server: http.Server; port: number };
  let nginx: ChildProcess;
  let dir: string;
  const NGX = 18480; // with the secret include
  const NGX_FORGOT = 18481; // the same block with the include missing

  const block = (listen: number, includeSecret: boolean) => `
    server {
      listen 127.0.0.1:${listen};
      location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        ${includeSecret ? `include ${'DIR'}/secrets/naro-proxy-auth.conf;` : '# include forgotten'}
        proxy_pass http://127.0.0.1:${'APP'};
      }
    }`;

  beforeAll(async () => {
    app = await startApp();
    dir = mkdtempSync(join(tmpdir(), 'naro-ngx-'));
    for (const d of ['secrets', 'tmp', 'logs']) mkdirSync(join(dir, d));
    // Root-only include in production (0600). nginx's master process reads its
    // config as root; workers never need the file.
    writeFileSync(join(dir, 'secrets', 'naro-proxy-auth.conf'), `proxy_set_header X-Naro-Proxy-Auth "${SECRET}";\n`);
    chmodSync(join(dir, 'secrets', 'naro-proxy-auth.conf'), 0o600);
    const conf = `
      daemon off;
      worker_processes 1;
      pid ${dir}/nginx.pid;
      error_log ${dir}/logs/error.log warn;
      events { worker_connections 64; }
      http {
        access_log off;
        client_body_temp_path ${dir}/tmp/body;
        proxy_temp_path ${dir}/tmp/proxy;
        fastcgi_temp_path ${dir}/tmp/fastcgi;
        uwsgi_temp_path ${dir}/tmp/uwsgi;
        scgi_temp_path ${dir}/tmp/scgi;
        ${block(NGX, true)}
        ${block(NGX_FORGOT, false)}
      }`.replace(/DIR/g, dir).replace(/APP/g, String(app.port));
    writeFileSync(join(dir, 'nginx.conf'), conf);
    const test = spawnSync(nginxBin, ['-t', '-e', join(dir, 'logs', 'early.log'), '-p', dir, '-c', join(dir, 'nginx.conf')], { encoding: 'utf8' });
    if (test.status !== 0) throw new Error(`nginx -t failed: ${test.stderr}`);
    nginx = spawn(nginxBin, ['-e', join(dir, 'logs', 'early.log'), '-p', dir, '-c', join(dir, 'nginx.conf')], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try { await get(NGX, '/ready'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('nginx did not start');
  }, 20_000);

  afterAll(async () => {
    nginx?.kill('SIGQUIT');
    await new Promise<void>((r) => app.server.close(() => r()));
  });

  it('the secret include is root-only (0600)', () => {
    expect(statSync(join(dir, 'secrets', 'naro-proxy-auth.conf')).mode & 0o777).toBe(0o600);
  });

  it('a visitor through nginx gets their own bucket: ip:<their address>', async () => {
    const a = await get(NGX, '/api/v1/products', {}, '127.0.0.7');
    const b = await get(NGX, '/api/v1/products', {}, '127.0.0.8');
    expect(a.ip).toBe('127.0.0.7');
    expect(a.withSecret).toBe('ip:127.0.0.7');
    expect(b.withSecret).toBe('ip:127.0.0.8');
  });

  it('a visitor can NOT forge the secret header: nginx overwrites it with exactly one value', async () => {
    const s = await get(NGX, '/api/v1/auth/login', { [PROXY_AUTH_HEADER]: 'forged-value' }, '127.0.0.7');
    expect(s.authValues).toEqual([SECRET]);
  });

  it('a visitor can NOT choose their bucket with a forged X-Forwarded-For', async () => {
    const s = await get(NGX, '/api/v1/auth/login', { 'X-Forwarded-For': '6.6.6.6' }, '127.0.0.7');
    expect(s.xff).toBe('6.6.6.6, 127.0.0.7'); // nginx appends the real address
    expect(s.withSecret).toBe('ip:127.0.0.7');
    expect(s.withoutSecret).toBe('ip:127.0.0.7'); // also true today (trust proxy = 1)
  });

  it('a visitor can never get the AI exemption through nginx, even with a valid token', async () => {
    const token = internalCallToken();
    const s = await get(NGX, '/api/v1/ai/products', { [INTERNAL_CALL_HEADER]: token }, '127.0.0.7');
    expect(s.aiExempt).toBe(false);
  });

  it('a local process that bypasses nginx is keyed by its real peer, whatever it claims', async () => {
    const s = await get(app.port, '/api/v1/auth/login', { 'X-Forwarded-For': '6.6.6.6', [PROXY_AUTH_HEADER]: 'forged-value' });
    expect(s.withSecret).toBe('peer:127.0.0.1');
  });

  it('ORDER MATTERS: env set but the nginx include missing → every visitor collapses into one peer bucket', async () => {
    const a = await get(NGX_FORGOT, '/api/v1/products', {}, '127.0.0.7');
    const b = await get(NGX_FORGOT, '/api/v1/products', {}, '127.0.0.8');
    expect(a.authValues).toEqual([]);
    expect(a.withSecret).toBe('peer:127.0.0.1');
    expect(b.withSecret).toBe('peer:127.0.0.1'); // → install nginx FIRST, then the env
  });

  it('nginx header first, env not yet set: behaviour is unchanged (safe intermediate step)', async () => {
    const s = await get(NGX, '/api/v1/products', {}, '127.0.0.7');
    expect(s.withoutSecret).toBe('ip:127.0.0.7');
  });
});
