import { Injectable, Logger } from '@nestjs/common';
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

    try {
      const url = `https://graph.facebook.com/v25.0/${encodeURIComponent(accountId)}/media`;
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
        return { synced: 0, errors: 1 };
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
    } catch (err) {
      this.logger.error(`Instagram API call failed (tenant ${tenantId}): ${this.describeGraphError(err)}`);
      errors++;
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
  private describeGraphError(err: unknown): string {
    const fbError = (err as any)?.response?.data?.error;
    if (fbError?.message) {
      const hint =
        fbError.code === 190
          ? ` — token expired/invalid: generate a new long-lived token and store it in the tenant's SiteSetting ${IG_SETTING_TOKEN}`
          : '';
      return `${fbError.type ?? 'GraphError'} code ${fbError.code}: ${fbError.message}${hint}`;
    }
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
      const response = await axios.get('https://graph.facebook.com/v25.0/oauth/access_token', {
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
}
