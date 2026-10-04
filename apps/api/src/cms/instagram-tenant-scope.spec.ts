import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { InstagramService, isSyncDue } from './instagram.service';
import { __resetDefaultTenantCache } from '../tenant/default-tenant';
import { PERMISSIONS_KEY } from '../auth/decorators/requires-permission.decorator';
import { CmsController } from './cms.controller';
import { isPrivilegedSettingKey, adminHasPermission } from './settings-permissions';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Row = { id: string; tenantId: string | null; key: string; value: string };

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

function config(env: Record<string, string>) {
  return { get: jest.fn((k: string, d?: string) => env[k] ?? d) } as any;
}

describe('InstagramService — strict per-tenant sync', () => {
  beforeEach(() => {
    __resetDefaultTenantCache();
    mockedAxios.get.mockReset();
    delete process.env.DEFAULT_TENANT_SLUG;
    delete process.env.NEXT_PUBLIC_TENANT_SLUG;
  });

  it('reads ONLY the calling tenant\'s token — never another tenant\'s row', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [{ id: '1', tenantId: 'A', key: 'instagram_access_token', value: 'tokA' }],
    });
    const svc = new InstagramService(prisma, config({ INSTAGRAM_ACCESS_TOKEN: 'envTok' }));
    expect(await svc.getActiveToken('A')).toBe('tokA');
    // B has no row and (2 tenants, no DEFAULT slug) is not the default → no env fallback either.
    expect(await svc.getActiveToken('B')).toBe('');
  });

  it('env token/account id fall back only for the default tenant (sole tenant = current prod)', async () => {
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'naro' }], settings: [] });
    const svc = new InstagramService(prisma, config({ INSTAGRAM_ACCESS_TOKEN: 'envTok', INSTAGRAM_BUSINESS_ACCOUNT_ID: '178' }));
    expect(await svc.getActiveToken('A')).toBe('envTok');
    expect(await svc.getAccountId('A')).toBe('178');
  });

  it('default tenant honours the legacy NULL-tenant token row before env', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'naro' }],
      settings: [{ id: '1', tenantId: null, key: 'instagram_access_token', value: 'rotated' }],
    });
    const svc = new InstagramService(prisma, config({ INSTAGRAM_ACCESS_TOKEN: 'stale' }));
    expect(await svc.getActiveToken('A')).toBe('rotated');
  });

  it('DEFAULT_TENANT_SLUG selects the env-owning tenant among many', async () => {
    process.env.DEFAULT_TENANT_SLUG = 'b';
    const prisma = makePrisma({ tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }], settings: [] });
    const svc = new InstagramService(prisma, config({ INSTAGRAM_ACCESS_TOKEN: 'envTok' }));
    expect(await svc.getActiveToken('A')).toBe('');
    expect(await svc.getActiveToken('B')).toBe('envTok');
  });

  it('upserts by compound (tenantId, instagramMediaId) and never rewrites tenantId on update', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [
        { id: '1', tenantId: 'A', key: 'instagram_access_token', value: 'tokA' },
        { id: '2', tenantId: 'A', key: 'instagram_business_account_id', value: 'acctA' },
      ],
    });
    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: '999', media_type: 'IMAGE', media_url: 'https://cdn/x.jpg', caption: 'c' }] },
    } as any);
    // media download → fail so the remote URL is stored (no disk writes in tests)
    mockedAxios.get.mockRejectedValueOnce(new Error('no network'));
    const svc = new InstagramService(prisma, config({}));
    const r = await svc.syncTenant('A');
    expect(r.synced).toBe(1);
    const call = prisma.instagramPost.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId_instagramMediaId: { tenantId: 'A', instagramMediaId: '999' } });
    expect(call.update).not.toHaveProperty('tenantId');
    expect(call.create.tenantId).toBe('A');
    expect(mockedAxios.get.mock.calls[0][0]).toContain('/acctA/media');
    // last-sync recorded on the tenant's own row
    expect(prisma._settings.find((s: Row) => s.key === 'instagram_last_sync_at')?.tenantId).toBe('A');
  });

  it('token refresh writes back to the SAME tenant\'s row (never a NULL-tenant row)', async () => {
    const prisma = makePrisma({
      tenants: [{ id: 'A', slug: 'a' }, { id: 'B', slug: 'b' }],
      settings: [{ id: '1', tenantId: 'B', key: 'instagram_access_token', value: 'old' }],
    });
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'new' } } as any);
    const svc = new InstagramService(prisma, config({}));
    expect(await svc.refreshAccessToken('B')).toBe(true);
    const up = prisma.siteSetting.upsert.mock.calls[0][0];
    expect(up.where.tenantId_key).toEqual({ tenantId: 'B', key: 'instagram_access_token' });
    expect(prisma._settings.find((s: Row) => s.tenantId === 'B')?.value).toBe('new');
  });

  it('sweep syncs only due, non-suspended tenants with a token', async () => {
    const now = new Date('2026-10-04T12:15:00Z');
    const prisma = makePrisma({
      tenants: [
        { id: 'A', slug: 'a' },
        { id: 'B', slug: 'b' },
        { id: 'S', slug: 's', status: 'SUSPENDED' },
        { id: 'N', slug: 'n' },
      ],
      settings: [
        { id: '1', tenantId: 'A', key: 'instagram_access_token', value: 't' },
        { id: '2', tenantId: 'A', key: 'instagram_sync_interval', value: 'EVERY_HOUR' },
        { id: '3', tenantId: 'A', key: 'instagram_last_sync_at', value: '2026-10-04T11:15:00Z' },
        { id: '4', tenantId: 'B', key: 'instagram_access_token', value: 't' },
        { id: '5', tenantId: 'B', key: 'instagram_sync_interval', value: 'DAILY' },
        { id: '6', tenantId: 'B', key: 'instagram_last_sync_at', value: '2026-10-04T06:00:00Z' },
        { id: '7', tenantId: 'S', key: 'instagram_access_token', value: 't' },
      ],
    });
    const svc = new InstagramService(prisma, config({}));
    const spy = jest.spyOn(svc, 'syncTenant').mockResolvedValue({ synced: 0, errors: 0 });
    await svc.syncAllDueTenants(now);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['A']);
  });

  it('isSyncDue honours per-tenant interval, OFF, and default', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    expect(isSyncDue('OFF', null, now)).toBe(false);
    expect(isSyncDue(null, null, now)).toBe(true);
    expect(isSyncDue('EVERY_6_HOURS', '2026-10-04T09:00:00Z', now)).toBe(false);
    expect(isSyncDue('EVERY_6_HOURS', '2026-10-04T06:00:00Z', now)).toBe(true);
    expect(isSyncDue('EVERY_HOUR', '2026-10-04T11:02:00Z', now)).toBe(true); // within tolerance
  });
});

describe('CMS RBAC wiring', () => {
  it('Instagram sync/config require cms:manage', () => {
    for (const m of ['syncInstagramPosts', 'getInstagramSyncConfig', 'updateInstagramSyncConfig'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, (CmsController.prototype as any)[m])).toEqual(['cms:manage']);
    }
  });

  it('settings writes require settings:manage (cms:manage only for non-privileged keys)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CmsController.prototype.updateSetting)).toEqual([
      'settings:manage',
      'cms:manage',
    ]);
    for (const k of ['auth_access_token_expires', 'auth_refresh_token_expires', 'instagram_access_token',
      'instagram_business_account_id', 'facebook_app_secret', 'smtp_password', 'some_api_key']) {
      expect(isPrivilegedSettingKey(k)).toBe(true);
    }
    for (const k of ['hero_title', 'rental_section_features', 'site_name', 'parallax_enabled']) {
      expect(isPrivilegedSettingKey(k)).toBe(false);
    }
  });

  it('the CMS controller no longer touches the platform-wide cron registry', () => {
    const src = fs.readFileSync(path.join(__dirname, 'cms.controller.ts'), 'utf8');
    expect(src).not.toMatch(/schedulerRegistry|new CronJob/);
  });

  it('adminHasPermission mirrors PermissionGuard bypass rules', async () => {
    const prisma: any = {
      adminUserRole: {
        findMany: jest.fn(async () => [{ role: { permissions: [{ permission: { code: 'cms:manage' } }] } }]),
      },
    };
    expect(await adminHasPermission(prisma, { role: 'SUPER_ADMIN' }, 'settings:manage')).toBe(true);
    expect(await adminHasPermission(prisma, { isPlatformAdmin: true }, 'settings:manage')).toBe(true);
    expect(await adminHasPermission(prisma, { id: 'u', role: 'MANAGER' }, 'settings:manage')).toBe(false);
    expect(await adminHasPermission(prisma, { id: 'u', role: 'MANAGER' }, 'cms:manage')).toBe(true);
  });
});
