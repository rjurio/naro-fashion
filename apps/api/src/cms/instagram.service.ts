import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { resolveDefaultTenantId } from '../tenant/default-tenant';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

const INSTAGRAM_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'instagram');

export const IG_SETTING_TOKEN = 'instagram_access_token';
export const IG_SETTING_ACCOUNT_ID = 'instagram_business_account_id';
export const IG_SETTING_INTERVAL = 'instagram_sync_interval';
export const IG_SETTING_LAST_SYNC = 'instagram_last_sync_at';
export const IG_DEFAULT_INTERVAL = 'EVERY_6_HOURS';
/** Non-secret connection metadata (safe to show to admins). */
export const IG_SETTING_TOKEN_TYPE = 'instagram_token_type';
export const IG_SETTING_PAGE_ID = 'instagram_page_id';
export const IG_SETTING_PAGE_NAME = 'instagram_page_name';
export const IG_SETTING_USERNAME = 'instagram_username';
export const IG_SETTING_TOKEN_EXPIRES_AT = 'instagram_token_expires_at';
export const IG_SETTING_DATA_ACCESS_EXPIRES_AT = 'instagram_data_access_expires_at';
export const IG_SETTING_TOKEN_CHECKED_AT = 'instagram_token_checked_at';
export const IG_SETTING_TOKEN_VALID = 'instagram_token_valid';
export const IG_SETTING_LAST_ERROR = 'instagram_last_sync_error';

export const GRAPH_BASE = 'https://graph.facebook.com/v25.0';
/** A user token expiring within this window raises INSTAGRAM_TOKEN_EXPIRING. */
export const IG_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
const TOKEN_STATUS_CACHE_MS = 10 * 60 * 1000;
const MAX_ACCOUNT_PAGES = 10;

export interface InstagramConnectResult {
  pageName: string;
  igUsername: string | null;
  tokenType: 'PAGE';
  /** ISO date or 'never'. */
  expiresAt: string;
  scopes: string[];
  synced: number;
  syncErrors: number;
}

export interface InstagramTokenStatus {
  connected: boolean;
  tokenType: string | null;
  pageName: string | null;
  igUsername: string | null;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  checkedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  valid: boolean;
  scopes: string[];
}

export interface InstagramTokenCheckResult {
  tenantId: string;
  tokenType: string | null;
  valid: boolean;
  /** ISO date or 'never' (null if debug_token couldn't be reached). */
  expiresAt: string | null;
  /** USER token invalid or expiring within IG_EXPIRY_WARNING_MS. */
  expiringSoon: boolean;
  /** fb_exchange_token was attempted (USER tokens only). */
  exchanged: boolean;
  error?: string;
}

interface DebugTokenInfo {
  isValid: boolean;
  type: string | null;
  appId: string | null;
  /** 0 = never expires. */
  expiresAt: number;
  dataAccessExpiresAt: number;
  scopes: string[];
  errorMessage: string | null;
}

/** Last 4 chars only — the most of a token we ever log. */
export function tokenHint(token: string | null | undefined): string {
  if (!token) return '(none)';
  return `…${token.slice(-4)}`;
}

/** Unix seconds (0 = never) → ISO or 'never'. */
export function expiryToIso(expiresAt: number): string {
  return !expiresAt ? 'never' : new Date(expiresAt * 1000).toISOString();
}

/** Per-tenant sync interval keys (same keys the admin UI already uses). */
export const INSTAGRAM_SYNC_INTERVAL_MS: Record<string, number | null> = {
  OFF: null,
  EVERY_HOUR: 60 * 60 * 1000,
  EVERY_3_HOURS: 3 * 60 * 60 * 1000,
  EVERY_6_HOURS: 6 * 60 * 60 * 1000,
  EVERY_12_HOURS: 12 * 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

// The hourly cron can fire a few minutes early relative to the previous
// run's timestamp; allow that slack so an hourly tenant isn't skipped.
const DUE_TOLERANCE_MS = 5 * 60 * 1000;

/** Pure due-check: should a tenant with this interval/last-sync run now? */
export function isSyncDue(interval: string | null | undefined, lastSyncIso: string | null | undefined, now: Date): boolean {
  const key = interval && interval in INSTAGRAM_SYNC_INTERVAL_MS ? interval : IG_DEFAULT_INTERVAL;
  const ms = INSTAGRAM_SYNC_INTERVAL_MS[key];
  if (!ms) return false; // OFF
  if (!lastSyncIso) return true;
  const last = Date.parse(lastSyncIso);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= ms - DUE_TOLERANCE_MS;
}

const BLOCKED_STATUSES = ['SUSPENDED', 'DEACTIVATED'];

/**
 * Instagram feed sync — STRICTLY PER TENANT.
 *
 * Before (cross-tenant bug): posts were upserted by the GLOBAL
 * instagramMediaId with `update: { tenantId }` (a sync could MOVE another
 * tenant's posts into the caller's tenant); the token was read from ANY
 * tenant's SiteSetting row; the business account id was a single env var;
 * any tenant admin could reschedule / switch off the ONE platform-wide cron;
 * and the token refresh wrote a NULL-tenant SiteSetting row.
 *
 * Now, for each tenant:
 *   - token      = SiteSetting(tenantId, 'instagram_access_token')
 *   - account id = SiteSetting(tenantId, 'instagram_business_account_id')
 *   - env INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID are a
 *     fallback ONLY for the deployment's default tenant (DEFAULT_TENANT_SLUG
 *     / NEXT_PUBLIC_TENANT_SLUG, or the sole tenant) — keeps current
 *     single-tenant prod working with zero config changes
 *   - posts upserted by compound key (tenantId, instagramMediaId)
 *   - interval = SiteSetting(tenantId, 'instagram_sync_interval'); an hourly
 *     cron syncs each tenant whose own interval has elapsed since
 *     SiteSetting(tenantId, 'instagram_last_sync_at')
 *   - refreshed tokens are written back to THAT tenant's row
 */
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------- settings

  private async getTenantSetting(tenantId: string, key: string): Promise<string | null> {
    try {
      const row = await this.prisma.siteSetting.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      return row?.value || null;
    } catch {
      return null;
    }
  }

  private async setTenantSetting(tenantId: string, key: string, value: string): Promise<void> {
    await this.prisma.siteSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value },
      create: { tenantId, key, value, type: 'string' },
    });
  }

  private async isDefaultTenant(tenantId: string): Promise<boolean> {
    return (await resolveDefaultTenantId(this.prisma)) === tenantId;
  }

  /**
   * The tenant's active access token: its own SiteSetting row first (the
   * refresh cron rotates this), then — for the default tenant ONLY — the
   * deploy-time env var. Never another tenant's token.
   */
  async getActiveToken(tenantId: string): Promise<string> {
    if (!tenantId) return '';
    const own = await this.getTenantSetting(tenantId, IG_SETTING_TOKEN);
    if (own) return own;
    if (await this.isDefaultTenant(tenantId)) {
      // Legacy: the old refresh code created/updated a NULL-tenant row, and
      // prod's live rotated token may still sit there. Honour it for the
      // default tenant only; the next refresh migrates it to the tenant row.
      const legacy = await this.getLegacyNullTenantSetting(IG_SETTING_TOKEN);
      if (legacy) return legacy;
      return this.configService.get<string>('INSTAGRAM_ACCESS_TOKEN', '') || '';
    }
    return '';
  }

  private async getLegacyNullTenantSetting(key: string): Promise<string | null> {
    try {
      const row = await this.prisma.siteSetting.findFirst({ where: { tenantId: null, key } });
      return row?.value || null;
    } catch {
      return null;
    }
  }

  /** The tenant's IG business account id (SiteSetting, env for default tenant only). */
  async getAccountId(tenantId: string): Promise<string> {
    if (!tenantId) return '';
    const own = await this.getTenantSetting(tenantId, IG_SETTING_ACCOUNT_ID);
    if (own) return own;
    if (await this.isDefaultTenant(tenantId)) {
      return this.configService.get<string>('INSTAGRAM_BUSINESS_ACCOUNT_ID', '') || '';
    }
    return '';
  }

  // -------------------------------------------------------------------- sync

  /**
   * Sync one tenant. Without a tenantId (legacy callers such as the
   * scheduler's dynamic job) this runs the per-tenant due-check sweep
   * instead — it NEVER picks "some" tenant.
   */
  async syncFromInstagram(tenantId?: string): Promise<{ synced: number; errors: number }> {
    if (!tenantId) return this.syncAllDueTenants();
    return this.syncTenant(tenantId);
  }

  /** Hourly sweep: each eligible tenant syncs when its own interval elapsed. */
  @Cron('15 * * * *', { name: 'instagram-sync-per-tenant' })
  async handleHourlySweep() {
    await this.syncAllDueTenants();
  }

  async syncAllDueTenants(now: Date = new Date()): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { notIn: BLOCKED_STATUSES } },
      select: { id: true },
    });
    for (const t of tenants) {
      try {
        const [interval, lastSync] = await Promise.all([
          this.getTenantSetting(t.id, IG_SETTING_INTERVAL),
          this.getTenantSetting(t.id, IG_SETTING_LAST_SYNC),
        ]);
        if (!isSyncDue(interval, lastSync, now)) continue;
        // Only tenants that actually have a token (own or default-env).
        if (!(await this.getActiveToken(t.id))) continue;
        const r = await this.syncTenant(t.id);
        synced += r.synced;
        errors += r.errors;
      } catch (err) {
        errors++;
        this.logger.error(`Instagram sweep failed for tenant ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { synced, errors };
  }

  async syncTenant(tenantId: string): Promise<{ synced: number; errors: number }> {
    if (this.inFlight.has(tenantId)) {
      return { synced: 0, errors: 0 };
    }
    this.inFlight.add(tenantId);
    try {
      return await this.doSyncTenant(tenantId);
    } finally {
      this.inFlight.delete(tenantId);
    }
  }

  private async doSyncTenant(tenantId: string): Promise<{ synced: number; errors: number }> {
    const token = await this.getActiveToken(tenantId);
    const accountId = await this.getAccountId(tenantId);

    if (!token || !accountId) {
      this.logger.warn(
        `Instagram not configured for tenant ${tenantId} — set SiteSetting ${IG_SETTING_TOKEN} and ${IG_SETTING_ACCOUNT_ID}`,
      );
      return { synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;
    let lastError = '';

    try {
      const url = `${GRAPH_BASE}/${encodeURIComponent(accountId)}/media`;
      const response = await axios.get(url, {
        params: {
          fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
          access_token: token,
          // Pull more than the storefront grid renders so older pinned /
          // promoted posts keep fresh image URLs too.
          limit: 50,
        },
        timeout: 15000,
      });

      const posts = response.data?.data;
      if (!Array.isArray(posts)) {
        this.logger.warn(`Instagram API returned unexpected format (tenant ${tenantId})`);
        throw new Error('Instagram API returned an unexpected response format');
      }

      for (const post of posts) {
        try {
          const remoteUrl =
            post.media_type === 'VIDEO'
              ? post.thumbnail_url || post.media_url
              : post.media_url;

          if (!remoteUrl || typeof post.id !== 'string' || !/^[0-9A-Za-z_]+$/.test(post.id)) continue;

          // Mirror the IG CDN image locally (signed URLs expire in ~24h).
          let imageUrl: string;
          try {
            imageUrl = await this.downloadInstagramMedia(remoteUrl, post.id);
          } catch (dlErr) {
            this.logger.warn(
              `Instagram media download failed for ${post.id}, storing remote URL as fallback: ${dlErr instanceof Error ? dlErr.message : dlErr}`,
            );
            imageUrl = remoteUrl;
          }

          const fields = {
            caption: post.caption || null,
            imageUrl,
            postUrl: post.permalink || null,
            likes: 0,
            mediaType: post.media_type || null,
            postedAt: post.timestamp ? new Date(post.timestamp) : null,
          };

          // Compound (tenantId, instagramMediaId) key: the same IG media can
          // exist independently per tenant, and `update` never touches
          // tenantId — a sync can no longer move another tenant's post.
          await this.prisma.instagramPost.upsert({
            where: { tenantId_instagramMediaId: { tenantId, instagramMediaId: post.id } },
            update: fields,
            create: {
              ...fields,
              tenantId,
              instagramMediaId: post.id,
              source: 'INSTAGRAM_API',
              isActive: true,
              sortOrder: 0,
            },
          });
          synced++;
        } catch (err) {
          this.logger.error(`Failed to upsert IG post ${post?.id} (tenant ${tenantId}): ${err instanceof Error ? err.message : err}`);
          errors++;
        }
      }

      this.logger.log(`Instagram sync completed for tenant ${tenantId}: ${synced} synced, ${errors} errors`);
      lastError = '';
    } catch (err) {
      lastError = this.describeGraphError(err);
      this.logger.error(`Instagram API call failed (tenant ${tenantId}): ${lastError}`);
      errors++;
    }

    // Surface the last Graph failure in Admin → CMS → Instagram (cleared on success).
    try {
      await this.setTenantSetting(tenantId, IG_SETTING_LAST_ERROR, lastError.slice(0, 500));
    } catch {
      /* non-fatal */
    }

    // Record the attempt so the hourly sweep honours the tenant's interval
    // (also on failure — avoids hammering Graph every hour with a dead token).
    try {
      await this.setTenantSetting(tenantId, IG_SETTING_LAST_SYNC, new Date().toISOString());
    } catch (err) {
      this.logger.warn(`Could not record ${IG_SETTING_LAST_SYNC} for tenant ${tenantId}: ${(err as Error).message}`);
    }

    return { synced, errors };
  }

  /**
   * Surface the Graph API error body, not just the axios status line.
   * "Request failed with status code 400" hid a token expiry for 10 weeks;
   * the body says exactly what's wrong (OAuthException code 190 etc.).
   */
  describeGraphError(err: unknown): string {
    const fbError = (err as any)?.response?.data?.error;
    if (fbError?.message) {
      let hint = '';
      if (fbError.code === 190) {
        hint = ' — token expired/invalid: re-connect Instagram in Admin → CMS → Instagram (paste a fresh Graph API Explorer token)';
      } else if (fbError.code === 10 || fbError.code === 200 || (fbError.code >= 200 && fbError.code < 300)) {
        hint = ' — missing permission: the token needs instagram_basic, pages_show_list, pages_read_engagement, business_management';
      }
      return `${fbError.type ?? 'GraphError'} code ${fbError.code}: ${fbError.message}${hint}`;
    }
    // Never echo axios internals (err.config carries the access_token / app secret).
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Download an Instagram CDN media URL to local disk and return a
   * `/uploads/instagram/<mediaId>.<ext>` path. IG media ids are globally
   * unique, so two tenants mirroring the same media share one identical
   * file harmlessly. Idempotent; writes to .part then renames atomically.
   */
  private async downloadInstagramMedia(remoteUrl: string, mediaId: string): Promise<string> {
    const pathPart = remoteUrl.split('?')[0];
    const extMatch = pathPart.match(/\.(jpe?g|png|webp|gif|mp4)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
    const fileName = `${mediaId}.${ext}`;
    const finalPath = path.join(INSTAGRAM_UPLOADS_DIR, fileName);
    const publicPath = `/uploads/instagram/${fileName}`;

    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
      return publicPath;
    }

    fs.mkdirSync(INSTAGRAM_UPLOADS_DIR, { recursive: true });
    const tmpPath = `${finalPath}.part`;

    const response = await axios.get(remoteUrl, {
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: 15 * 1024 * 1024,
    });
    await pipeline(response.data, fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, finalPath);

    return publicPath;
  }

  // ----------------------------------------------------------------- refresh

  /**
   * Refresh long-lived tokens (60-day expiry). With a tenantId: that tenant
   * only. Without (the scheduler's 1st/15th cron): every non-blocked tenant
   * holding a token. The rotated token is written back to the SAME tenant's
   * SiteSetting row — never a NULL-tenant row.
   */
  async refreshAccessToken(tenantId?: string): Promise<boolean> {
    if (tenantId) return this.refreshTenantToken(tenantId);

    const tenants = await this.prisma.tenant.findMany({
      where: { status: { notIn: BLOCKED_STATUSES } },
      select: { id: true },
    });
    let anyOk = false;
    for (const t of tenants) {
      if (!(await this.getActiveToken(t.id))) continue;
      if (await this.refreshTenantToken(t.id)) anyOk = true;
    }
    return anyOk;
  }

  private async refreshTenantToken(tenantId: string): Promise<boolean> {
    // Refresh the NEWEST token this tenant holds (its SiteSetting first).
    const token = await this.getActiveToken(tenantId);
    if (!token) {
      this.logger.warn(`No Instagram access token to refresh for tenant ${tenantId}`);
      return false;
    }

    try {
      const response = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.configService.get<string>('FACEBOOK_APP_ID', ''),
          client_secret: this.configService.get<string>('FACEBOOK_APP_SECRET', ''),
          fb_exchange_token: token,
        },
        timeout: 15000,
      });

      const newToken = response.data?.access_token;
      if (newToken) {
        await this.setTenantSetting(tenantId, IG_SETTING_TOKEN, newToken);
        this.logger.log(`Instagram access token refreshed for tenant ${tenantId}`);
        return true;
      }

      this.logger.warn(`Token refresh response missing access_token (tenant ${tenantId})`);
      return false;
    } catch (err) {
      this.logger.error(`Instagram token refresh failed (tenant ${tenantId}): ${this.describeGraphError(err)}`);
      return false;
    }
  }

  // ----------------------------------------------------- connect (Page token)

  private appCredentials(): { appId: string; appSecret: string } {
    const appId = this.configService.get<string>('FACEBOOK_APP_ID', '') || '';
    const appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET', '') || '';
    return { appId, appSecret };
  }

  /**
   * `GET /debug_token` with the app access token (`<app_id>|<app_secret>`,
   * server-side only). Throws on transport errors / missing app config.
   */
  private async debugToken(inputToken: string): Promise<DebugTokenInfo> {
    const { appId, appSecret } = this.appCredentials();
    if (!appId || !appSecret) {
      throw new Error('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not configured on the server');
    }
    const res = await axios.get(`${GRAPH_BASE}/debug_token`, {
      params: { input_token: inputToken, access_token: `${appId}|${appSecret}` },
      timeout: 15000,
    });
    const d = res.data?.data ?? {};
    return {
      isValid: d.is_valid === true,
      type: typeof d.type === 'string' ? d.type.toUpperCase() : null,
      appId: d.app_id != null ? String(d.app_id) : null,
      expiresAt: Number(d.expires_at) || 0,
      dataAccessExpiresAt: Number(d.data_access_expires_at) || 0,
      scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
      errorMessage: d.error?.message ? String(d.error.message) : null,
    };
  }

  /**
   * Turn a (short- or long-lived) Facebook USER token from Graph API
   * Explorer into the tenant's durable credential: a Page access token
   * derived from a long-lived user token, which Facebook issues with NO
   * expiry (debug_token expires_at = 0). Long-lived user tokens die 60 days
   * after issue and `fb_exchange_token` does NOT extend them — that is what
   * froze the feed on 2026-09-26.
   *
   * Tokens are never logged (last 4 chars at most) and never returned.
   */
  async connectWithUserToken(tenantId: string, userToken: string): Promise<InstagramConnectResult> {
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    const rawUserToken = (userToken ?? '').trim();
    if (!rawUserToken) throw new BadRequestException('Paste the User access token from Graph API Explorer');

    const { appId, appSecret } = this.appCredentials();
    if (!appId || !appSecret) {
      throw new BadRequestException(
        'Instagram connect is not configured on the server (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing). Contact the platform operator.',
      );
    }

    // (a) short/long-lived user token → long-lived user token.
    let longLivedUserToken: string;
    try {
      const res = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: rawUserToken,
        },
        timeout: 15000,
      });
      longLivedUserToken = res.data?.access_token;
      if (!longLivedUserToken) throw new Error('Facebook did not return a long-lived token');
    } catch (err) {
      const msg = this.describeGraphError(err);
      this.logger.warn(`Instagram connect: user-token exchange failed (tenant ${tenantId}): ${msg}`);
      throw new BadRequestException(`Facebook rejected the pasted token: ${msg}`);
    }

    // (b) Pages this user administers, with their linked IG business account.
    type PageRow = {
      id: string;
      name: string;
      access_token?: string;
      instagram_business_account?: { id: string; username?: string };
    };
    const pages: PageRow[] = [];
    try {
      let url: string | null = `${GRAPH_BASE}/me/accounts`;
      let params: Record<string, string | number> | undefined = {
        fields: 'id,name,access_token,instagram_business_account{id,username}',
        limit: 100,
        access_token: longLivedUserToken,
      };
      for (let i = 0; url && i < MAX_ACCOUNT_PAGES; i++) {
        const res: any = await axios.get(url, { params, timeout: 15000 });
        const rows = res.data?.data;
        if (Array.isArray(rows)) pages.push(...rows);
        url = typeof res.data?.paging?.next === 'string' ? res.data.paging.next : null;
        params = undefined; // `next` already carries every query param
      }
    } catch (err) {
      const msg = this.describeGraphError(err);
      this.logger.warn(`Instagram connect: /me/accounts failed (tenant ${tenantId}): ${msg}`);
      throw new BadRequestException(`Could not list your Facebook Pages: ${msg}`);
    }

    // (c) pick the Page linked to the tenant's IG business account.
    const withIg = pages.filter((p) => p.instagram_business_account?.id);
    const describePages = () =>
      pages.length
        ? pages
            .map((p) =>
              p.instagram_business_account?.id
                ? `"${p.name}" (Instagram ${p.instagram_business_account.username ? '@' + p.instagram_business_account.username : p.instagram_business_account.id})`
                : `"${p.name}" (no Instagram business account linked)`,
            )
            .join(', ')
        : 'none';

    const configuredIgId = await this.getAccountId(tenantId);
    let page: PageRow | undefined;
    if (configuredIgId) {
      page = withIg.find((p) => p.instagram_business_account!.id === configuredIgId);
      if (!page) {
        throw new BadRequestException(
          `None of your Facebook Pages is linked to Instagram account ${configuredIgId}. Pages found: ${describePages()}. ` +
            'Log in to Graph API Explorer as an admin of the Page linked to the shop\'s Instagram account and tick pages_show_list.',
        );
      }
    } else if (withIg.length === 1) {
      page = withIg[0];
    } else {
      throw new BadRequestException(
        withIg.length === 0
          ? `No Facebook Page with a linked Instagram business account was found. Pages found: ${describePages()}.`
          : `Several Pages have an Instagram account — set ${IG_SETTING_ACCOUNT_ID} first to choose one. Pages found: ${describePages()}.`,
      );
    }

    const pageToken = page.access_token;
    const igId = page.instagram_business_account!.id;
    if (!pageToken) {
      throw new BadRequestException(
        `Facebook returned Page "${page.name}" without a Page token — make sure you are an admin of that Page and granted pages_show_list.`,
      );
    }

    // (d) verify the Page token, then prove it can read the media edge.
    let info: DebugTokenInfo;
    try {
      info = await this.debugToken(pageToken);
    } catch (err) {
      throw new BadRequestException(`Could not verify the Page token: ${this.describeGraphError(err)}`);
    }
    if (!info.isValid) {
      throw new BadRequestException(
        `Facebook reports the Page token for "${page.name}" as invalid${info.errorMessage ? `: ${info.errorMessage}` : ''}.`,
      );
    }
    if (info.appId && info.appId !== appId) {
      throw new BadRequestException(
        'The pasted token was generated for a different Facebook app. In Graph API Explorer choose the app "Narofashion".',
      );
    }
    try {
      await axios.get(`${GRAPH_BASE}/${encodeURIComponent(igId)}/media`, {
        params: { fields: 'id', limit: 1, access_token: pageToken },
        timeout: 15000,
      });
    } catch (err) {
      throw new BadRequestException(
        `The Page token cannot read Instagram media yet: ${this.describeGraphError(err)}`,
      );
    }

    // (e) persist — tenant-scoped rows only.
    const expiresAtIso = expiryToIso(info.expiresAt);
    const nowIso = new Date().toISOString();
    const igUsername = page.instagram_business_account?.username ?? null;
    await this.setTenantSetting(tenantId, IG_SETTING_TOKEN, pageToken);
    await this.setTenantSetting(tenantId, IG_SETTING_ACCOUNT_ID, igId);
    await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_TYPE, 'PAGE');
    await this.setTenantSetting(tenantId, IG_SETTING_PAGE_ID, page.id);
    await this.setTenantSetting(tenantId, IG_SETTING_PAGE_NAME, page.name);
    await this.setTenantSetting(tenantId, IG_SETTING_USERNAME, igUsername ?? '');
    await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_EXPIRES_AT, expiresAtIso);
    await this.setTenantSetting(
      tenantId,
      IG_SETTING_DATA_ACCESS_EXPIRES_AT,
      info.dataAccessExpiresAt ? expiryToIso(info.dataAccessExpiresAt) : '',
    );
    await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_CHECKED_AT, nowIso);
    await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_VALID, 'true');
    this.statusCache.delete(tenantId);

    this.logger.log(
      `Instagram connected for tenant ${tenantId}: Page "${page.name}" → IG ${igUsername ? '@' + igUsername : igId}, ` +
        `PAGE token ${tokenHint(pageToken)}, expires ${expiresAtIso}`,
    );

    // (f) sync now.
    const r = await this.syncTenant(tenantId);
    return {
      pageName: page.name,
      igUsername,
      tokenType: 'PAGE',
      expiresAt: expiresAtIso,
      scopes: info.scopes,
      synced: r.synced,
      syncErrors: r.errors,
    };
  }

  // ------------------------------------------------------------ token status

  private readonly statusCache = new Map<string, { at: number; hint: string; value: InstagramTokenStatus }>();

  /**
   * Admin-facing connection status. Calls debug_token live at most every
   * 10 minutes per tenant (or on `force`). NEVER includes the token.
   */
  async getTokenStatus(tenantId: string, force = false): Promise<InstagramTokenStatus> {
    const token = await this.getActiveToken(tenantId);
    const hint = tokenHint(token);
    const cached = this.statusCache.get(tenantId);
    if (!force && cached && cached.hint === hint && Date.now() - cached.at < TOKEN_STATUS_CACHE_MS) {
      // lastSync/lastError change on every sync — always read them fresh.
      const [lastSyncAt, lastError] = await Promise.all([
        this.getTenantSetting(tenantId, IG_SETTING_LAST_SYNC),
        this.getTenantSetting(tenantId, IG_SETTING_LAST_ERROR),
      ]);
      return { ...cached.value, lastSyncAt, lastError };
    }

    const keys = [
      IG_SETTING_TOKEN_TYPE,
      IG_SETTING_PAGE_NAME,
      IG_SETTING_USERNAME,
      IG_SETTING_TOKEN_EXPIRES_AT,
      IG_SETTING_DATA_ACCESS_EXPIRES_AT,
      IG_SETTING_TOKEN_CHECKED_AT,
      IG_SETTING_LAST_SYNC,
      IG_SETTING_LAST_ERROR,
      IG_SETTING_TOKEN_VALID,
    ];
    const values = await Promise.all(keys.map((k) => this.getTenantSetting(tenantId, k)));
    const s = Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<string, string | null>;

    const status: InstagramTokenStatus = {
      connected: !!token,
      tokenType: s[IG_SETTING_TOKEN_TYPE],
      pageName: s[IG_SETTING_PAGE_NAME],
      igUsername: s[IG_SETTING_USERNAME],
      expiresAt: s[IG_SETTING_TOKEN_EXPIRES_AT],
      dataAccessExpiresAt: s[IG_SETTING_DATA_ACCESS_EXPIRES_AT],
      checkedAt: s[IG_SETTING_TOKEN_CHECKED_AT],
      lastSyncAt: s[IG_SETTING_LAST_SYNC],
      lastError: s[IG_SETTING_LAST_ERROR],
      valid: s[IG_SETTING_TOKEN_VALID] === 'true',
      scopes: [],
    };

    if (!token) {
      status.valid = false;
      status.lastError = status.lastError || 'Instagram is not connected';
      return status;
    }

    try {
      const info = await this.debugToken(token);
      status.valid = info.isValid;
      status.tokenType = info.type ?? status.tokenType;
      status.expiresAt = expiryToIso(info.expiresAt);
      status.dataAccessExpiresAt = info.dataAccessExpiresAt ? expiryToIso(info.dataAccessExpiresAt) : null;
      status.scopes = info.scopes;
      status.checkedAt = new Date().toISOString();
      if (!info.isValid && info.errorMessage) status.lastError = info.errorMessage;
      await this.recordCheck(tenantId, info, status.checkedAt);
    } catch (err) {
      // Can't reach Graph / app not configured: report stored values.
      status.lastError = `Token check failed: ${this.describeGraphError(err)}`;
    }

    this.statusCache.set(tenantId, { at: Date.now(), hint, value: status });
    return status;
  }

  private async recordCheck(tenantId: string, info: DebugTokenInfo, checkedAtIso: string): Promise<void> {
    try {
      await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_CHECKED_AT, checkedAtIso);
      await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_VALID, info.isValid ? 'true' : 'false');
      if (info.isValid) {
        await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_EXPIRES_AT, expiryToIso(info.expiresAt));
        if (info.type) await this.setTenantSetting(tenantId, IG_SETTING_TOKEN_TYPE, info.type);
      }
    } catch (err) {
      this.logger.warn(`Could not record Instagram token check for tenant ${tenantId}: ${(err as Error).message}`);
    }
  }

  // -------------------------------------------------- scheduled token check

  /**
   * Daily token health check for every non-blocked tenant holding a token
   * (called by SchedulerService's `instagram-token-refresh` cron).
   *   - PAGE / never-expiring tokens: NO exchange; just record validity.
   *   - USER tokens: keep the (harmless) fb_exchange_token, but flag
   *     `expiringSoon` when invalid or < 14 days left — Facebook does NOT
   *     extend a long-lived user token by re-exchanging it.
   */
  async checkAllTenantTokens(now: Date = new Date()): Promise<InstagramTokenCheckResult[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { notIn: BLOCKED_STATUSES } },
      select: { id: true },
    });
    const results: InstagramTokenCheckResult[] = [];
    for (const t of tenants) {
      try {
        if (!(await this.getActiveToken(t.id))) continue;
        results.push(await this.checkTenantToken(t.id, now));
      } catch (err) {
        results.push({
          tenantId: t.id,
          tokenType: null,
          valid: false,
          expiresAt: null,
          expiringSoon: false,
          exchanged: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  async checkTenantToken(tenantId: string, now: Date = new Date()): Promise<InstagramTokenCheckResult> {
    const token = await this.getActiveToken(tenantId);
    const storedType = await this.getTenantSetting(tenantId, IG_SETTING_TOKEN_TYPE);
    const base: InstagramTokenCheckResult = {
      tenantId,
      tokenType: storedType,
      valid: false,
      expiresAt: null,
      expiringSoon: false,
      exchanged: false,
    };
    if (!token) return { ...base, error: 'no token' };

    let info: DebugTokenInfo | null = null;
    try {
      info = await this.debugToken(token);
    } catch (err) {
      base.error = `debug_token failed: ${this.describeGraphError(err)}`;
    }

    if (!info) {
      // Graph unreachable / app creds missing. Never exchange a PAGE token;
      // for anything else fall back to the legacy exchange.
      if (storedType !== 'PAGE') {
        base.exchanged = true;
        base.valid = await this.refreshTenantToken(tenantId);
      }
      return base;
    }

    const checkedAt = now.toISOString();
    await this.recordCheck(tenantId, info, checkedAt);
    this.statusCache.delete(tenantId);

    const tokenType = info.type ?? storedType;
    const result: InstagramTokenCheckResult = {
      ...base,
      tokenType,
      valid: info.isValid,
      expiresAt: expiryToIso(info.expiresAt),
      error: info.isValid ? undefined : info.errorMessage ?? 'token is invalid',
    };

    if (tokenType === 'PAGE' || (info.isValid && info.expiresAt === 0)) {
      return result; // durable token — nothing to exchange
    }

    // USER (or unknown, expiring) token.
    if (info.isValid) {
      result.exchanged = true;
      await this.refreshTenantToken(tenantId);
    }
    const msLeft = info.expiresAt ? info.expiresAt * 1000 - now.getTime() : Infinity;
    result.expiringSoon = !info.isValid || msLeft < IG_EXPIRY_WARNING_MS;
    return result;
  }
}
