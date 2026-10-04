import 'reflect-metadata';
import axios from 'axios';
import { Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InstagramService, tokenHint } from './instagram.service';
import { __resetDefaultTenantCache } from '../tenant/default-tenant';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { CmsController } from './cms.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { isSensitiveSettingKey } from './cms.service';
import { SchedulerService } from '../scheduler/scheduler.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Row = { id: string; tenantId: string | null; key: string; value: string };

const USER_TOKEN = 'EAAuserTOKENshort1111';
const LL_USER_TOKEN = 'EAAlongLIVEDuser2222';
const PAGE_TOKEN = 'EAApageTOKENsecret3333';
const OTHER_PAGE_TOKEN = 'EAAotherPAGEsecret4444';

function makePrisma(opts: { tenants: Array<{ id: string; slug: string; status?: string }>; settings: Row[] }) {
  const settings = [...opts.settings];
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => opts.tenants.find((t) => t.slug === where.slug) ?? null),
      findMany: jest.fn(async (args: any) => {
        let list = opts.tenants;
        if (args?.where?.status?.notIn) list = list.filter((t) => !args.where.status.notIn.includes(t.status ?? 'ACTIVE'));
        return (args?.take ? list.slice(0, args.take) : list).map((t) => ({ id: t.id }));
      }),
    },
    siteSetting: {
      findUnique: jest.fn(async ({ where }: any) =>
        settings.find((s) => s.tenantId === where.tenantId_key.tenantId && s.key === where.tenantId_key.key) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        settings.find((s) => s.tenantId === where.tenantId && s.key === where.key) ?? null,
      ),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = settings.find(
          (s) => s.tenantId === where.tenantId_key.tenantId && s.key === where.tenantId_key.key,
        );
        if (existing) Object.assign(existing, update);
        else settings.push({ id: String(settings.length), ...create });
      }),
    },
    instagramPost: { upsert: jest.fn(async () => ({})) },
    _settings: settings,
  };
  return prisma;
}

const config = (env: Record<string, string> = { FACEBOOK_APP_ID: 'app1', FACEBOOK_APP_SECRET: 'appSecretXYZ' }) =>
  ({ get: jest.fn((k: string, d?: string) => env[k] ?? d) }) as any;

const page = (id: string, name: string, token: string, ig?: { id: string; username?: string }) => ({
  id,
  name,
  access_token: token,
  ...(ig ? { instagram_business_account: ig } : {}),
});

/**
 * Route mocked Graph calls by URL. `pages` = /me/accounts rows;
 * `debug` = debug_token payload for the page token.
 */
function graph(opts: { pages: any[]; debug?: any; mediaFails?: boolean; exchangeFails?: boolean }) {
  mockedAxios.get.mockImplementation(async (url: string, cfg?: any) => {
    if (url.endsWith('/oauth/access_token')) {
      if (opts.exchangeFails) {
        throw Object.assign(new Error('400'), {
          response: { data: { error: { type: 'OAuthException', code: 190, message: 'Session has expired' } } },
        });
      }
      return { data: { access_token: LL_USER_TOKEN } } as any;
    }
    if (url.endsWith('/me/accounts')) return { data: { data: opts.pages } } as any;
    if (url.endsWith('/debug_token')) {
      return {
        data: {
          data: opts.debug ?? { is_valid: true, type: 'PAGE', app_id: 'app1', expires_at: 0, scopes: ['instagram_basic', 'pages_show_list'] },
        },
      } as any;
    }
    if (url.includes('/media')) {
      if (opts.mediaFails) throw new Error('media fail');
      // sync call has limit 50; verification call has limit 1
      return { data: { data: cfg?.params?.limit === 1 ? [{ id: '1' }] : [] } } as any;
    }
    throw new Error(`unexpected url ${url}`);
  });
}

describe('InstagramService.connectWithUserToken', () => {
  beforeEach(() => {
    __resetDefaultTenantCache();
    mockedAxios.get.mockReset();
    delete process.env.DEFAULT_TENANT_SLUG;
    delete process.env.NEXT_PUBLIC_TENANT_SLUG;
  });

  it('picks the Page whose IG business account matches the tenant setting and stores tenant-scoped rows', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [{ id: '1', tenantId: 'A', key: 'instagram_business_account_id', value: 'IG2' }],
    });
    graph({
      pages: [
        page('P1', 'Other Shop', OTHER_PAGE_TOKEN, { id: 'IG1', username: 'other' }),
        page('P2', 'Nancy Fashion', PAGE_TOKEN, { id: 'IG2', username: 'narofashion' }),
      ],
    });
    const svc = new InstagramService(prisma, config());
    const res = await svc.connectWithUserToken('A', USER_TOKEN);

    expect(res).toMatchObject({ pageName: 'Nancy Fashion', igUsername: 'narofashion', tokenType: 'PAGE', expiresAt: 'never' });
    // The token never leaks into the response.
    const json = JSON.stringify(res);
    for (const t of [USER_TOKEN, LL_USER_TOKEN, PAGE_TOKEN, OTHER_PAGE_TOKEN, 'appSecretXYZ']) expect(json).not.toContain(t);

    // Every write is tenant-scoped to A.
    for (const call of prisma.siteSetting.upsert.mock.calls) {
      expect(call[0].where.tenantId_key.tenantId).toBe('A');
      expect(call[0].create.tenantId).toBe('A');
    }
    const get = (k: string) => prisma._settings.find((s: Row) => s.tenantId === 'A' && s.key === k)?.value;
    expect(get('instagram_access_token')).toBe(PAGE_TOKEN);
    expect(get('instagram_token_type')).toBe('PAGE');
    expect(get('instagram_page_id')).toBe('P2');
    expect(get('instagram_page_name')).toBe('Nancy Fashion');
    expect(get('instagram_token_expires_at')).toBe('never');
    expect(get('instagram_token_checked_at')).toBeTruthy();
    expect(prisma._settings.some((s: Row) => s.tenantId !== 'A')).toBe(false);

    // Media edge tested with the Page token; app token used only for debug_token.
    const debugCall = mockedAxios.get.mock.calls.find((c) => String(c[0]).endsWith('/debug_token'))!;
    expect((debugCall[1] as any).params.input_token).toBe(PAGE_TOKEN);
    expect((debugCall[1] as any).params.access_token).toBe('app1|appSecretXYZ');
  });

  it('falls back to the single Page with an IG account when none is configured, and saves the IG id', async () => {
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }], settings: [] });
    graph({
      pages: [page('P0', 'No IG Page', OTHER_PAGE_TOKEN), page('P2', 'Nancy Fashion', PAGE_TOKEN, { id: 'IG2' })],
    });
    const svc = new InstagramService(prisma, config());
    const res = await svc.connectWithUserToken('A', USER_TOKEN);
    expect(res.pageName).toBe('Nancy Fashion');
    expect(prisma._settings.find((s: Row) => s.key === 'instagram_business_account_id')).toMatchObject({ tenantId: 'A', value: 'IG2' });
  });

  it('errors with the Page names (and no tokens) when no Page matches', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [{ id: '1', tenantId: 'A', key: 'instagram_business_account_id', value: 'IG9' }],
    });
    graph({ pages: [page('P1', 'Other Shop', OTHER_PAGE_TOKEN, { id: 'IG1' }), page('P3', 'Blog', PAGE_TOKEN)] });
    const svc = new InstagramService(prisma, config());
    const err: any = await svc.connectWithUserToken('A', USER_TOKEN).catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain('Other Shop');
    expect(err.message).toContain('Blog');
    expect(err.message).not.toContain(PAGE_TOKEN);
    expect(err.message).not.toContain(OTHER_PAGE_TOKEN);
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects when debug_token says the Page token is invalid (nothing stored)', async () => {
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }], settings: [] });
    graph({
      pages: [page('P2', 'Nancy Fashion', PAGE_TOKEN, { id: 'IG2' })],
      debug: { is_valid: false, type: 'PAGE', app_id: 'app1', expires_at: 0, error: { message: 'Session invalid' } },
    });
    const svc = new InstagramService(prisma, config());
    await expect(svc.connectWithUserToken('A', USER_TOKEN)).rejects.toThrow(/invalid/);
    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
  });

  it('surfaces a Graph rejection of the pasted token without echoing it', async () => {
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'a' }], settings: [] });
    graph({ pages: [], exchangeFails: true });
    const svc = new InstagramService(prisma, config());
    const err: any = await svc.connectWithUserToken('A', USER_TOKEN).catch((e) => e);
    expect(err.message).toMatch(/code 190/);
    expect(err.message).not.toContain(USER_TOKEN);
  });

  it('refuses to run without FACEBOOK_APP_ID / FACEBOOK_APP_SECRET', async () => {
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'a' }], settings: [] });
    const svc = new InstagramService(prisma, config({}));
    await expect(svc.connectWithUserToken('A', USER_TOKEN)).rejects.toThrow(/not configured/);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('token status never returns the token and caches debug_token for 10 minutes', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [
        { id: '1', tenantId: 'A', key: 'instagram_access_token', value: PAGE_TOKEN },
        { id: '2', tenantId: 'A', key: 'instagram_page_name', value: 'Nancy Fashion' },
      ],
    });
    graph({ pages: [] });
    const svc = new InstagramService(prisma, config());
    const s1 = await svc.getTokenStatus('A');
    const s2 = await svc.getTokenStatus('A');
    expect(s1).toMatchObject({ connected: true, valid: true, tokenType: 'PAGE', expiresAt: 'never', pageName: 'Nancy Fashion' });
    expect(JSON.stringify(s1)).not.toContain(PAGE_TOKEN);
    expect(JSON.stringify(s2)).not.toContain(PAGE_TOKEN);
    expect(mockedAxios.get.mock.calls.filter((c) => String(c[0]).endsWith('/debug_token'))).toHaveLength(1);
  });

  it('tokenHint exposes at most the last 4 chars', () => {
    expect(tokenHint(PAGE_TOKEN)).toBe('…3333');
    expect(tokenHint('')).toBe('(none)');
  });

  it('new metadata keys are not treated as secrets; the token key is', () => {
    expect(isSensitiveSettingKey('instagram_access_token')).toBe(true);
    for (const k of ['instagram_token_type', 'instagram_page_id', 'instagram_page_name', 'instagram_username',
      'instagram_token_expires_at', 'instagram_token_checked_at', 'instagram_last_sync_error']) {
      expect(isSensitiveSettingKey(k)).toBe(false);
    }
  });
});

describe('Instagram token check (cron)', () => {
  beforeEach(() => {
    __resetDefaultTenantCache();
    mockedAxios.get.mockReset();
  });

  it('PAGE token: records the check and does NOT call fb_exchange_token', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [
        { id: '1', tenantId: 'A', key: 'instagram_access_token', value: PAGE_TOKEN },
        { id: '2', tenantId: 'A', key: 'instagram_token_type', value: 'PAGE' },
      ],
    });
    graph({ pages: [] });
    const svc = new InstagramService(prisma, config());
    const [r] = await svc.checkAllTenantTokens(new Date('2026-10-04T03:00:00Z'));
    expect(r).toMatchObject({ tenantId: 'A', tokenType: 'PAGE', valid: true, expiresAt: 'never', exchanged: false, expiringSoon: false });
    expect(mockedAxios.get.mock.calls.some((c) => String(c[0]).endsWith('/oauth/access_token'))).toBe(false);
    expect(prisma._settings.find((s: Row) => s.key === 'instagram_token_checked_at')).toMatchObject({
      tenantId: 'A',
      value: '2026-10-04T03:00:00.000Z',
    });
  });

  it('USER token expiring within 14 days: exchanges (harmless) and flags expiringSoon', async () => {
    const now = new Date('2026-10-04T03:00:00Z');
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [{ id: '1', tenantId: 'A', key: 'instagram_access_token', value: LL_USER_TOKEN }],
    });
    graph({
      pages: [],
      debug: { is_valid: true, type: 'USER', app_id: 'app1', expires_at: Math.floor(now.getTime() / 1000) + 5 * 86400 },
    });
    const svc = new InstagramService(prisma, config());
    const [r] = await svc.checkAllTenantTokens(now);
    expect(r).toMatchObject({ tokenType: 'USER', valid: true, exchanged: true, expiringSoon: true });
  });

  it('scheduler logs INSTAGRAM_TOKEN_EXPIRING for an expiring user token and the remediation hint for a dead Page token', async () => {
    const errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const instagram: any = {
      checkAllTenantTokens: jest.fn(async () => [
        { tenantId: 'A', tokenType: 'USER', valid: true, expiresAt: '2026-10-09T00:00:00.000Z', expiringSoon: true, exchanged: true },
        { tenantId: 'B', tokenType: 'PAGE', valid: false, expiresAt: 'never', expiringSoon: false, exchanged: false, error: 'Session invalid' },
        { tenantId: 'C', tokenType: 'PAGE', valid: true, expiresAt: 'never', expiringSoon: false, exchanged: false },
      ]),
    };
    const prisma: any = { adminUser: { findFirst: jest.fn(async () => ({ email: 'owner@shop.tz', phone: '' })) } };
    const sched = new SchedulerService(prisma, {} as any, config({}), instagram, {} as any);
    await sched.handleInstagramTokenRefresh();
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('INSTAGRAM_TOKEN_EXPIRING') && l.includes('tenant A'))).toBe(true);
    expect(lines.some((l) => l.includes('tenant B') && l.includes('re-connect Instagram in Admin → CMS → Instagram'))).toBe(true);
    expect(lines.some((l) => l.includes('tenant C'))).toBe(false);
    jest.restoreAllMocks();
  });
});

describe('Instagram connect/status endpoint metadata', () => {
  const proto = CmsController.prototype as any;

  it('connect requires settings:manage behind JwtAuthGuard → AdminGuard → PermissionGuard and is throttled 5/min', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.connectInstagram)).toEqual(['settings:manage']);
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.connectInstagram)).toEqual([JwtAuthGuard, AdminGuard, PermissionGuard]);
    const keys = Reflect.getMetadataKeys(proto.connectInstagram).map(String);
    const limitKey = keys.find((k) => k.includes('THROTTLER:LIMIT'));
    expect(limitKey).toBeDefined();
    expect(Reflect.getMetadata(limitKey!, proto.connectInstagram)).toBe(5);
  });

  it('token-status requires cms:manage behind the admin guard stack', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getInstagramTokenStatus)).toEqual(['cms:manage']);
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.getInstagramTokenStatus)).toEqual([JwtAuthGuard, AdminGuard, PermissionGuard]);
  });
});
