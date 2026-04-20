import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

const INSTAGRAM_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'instagram');

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sync latest posts from Instagram Graph API into the database.
   * Upserts by instagramMediaId to avoid duplicates.
   * If tenantId is not provided, syncs for all active tenants (used by cron).
   */
  async syncFromInstagram(tenantId?: string): Promise<{ synced: number; errors: number }> {
    // If no tenantId, resolve the first active tenant (current single-tenant prod setup).
    // TODO: When we have multiple tenants with separate IG accounts, iterate each.
    if (!tenantId) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      tenantId = tenant?.id;
      if (!tenantId) {
        this.logger.warn('No active tenant found for Instagram sync');
        return { synced: 0, errors: 0 };
      }
    }

    const token = this.configService.get<string>('INSTAGRAM_ACCESS_TOKEN', '');
    const accountId = this.configService.get<string>('INSTAGRAM_BUSINESS_ACCOUNT_ID', '');

    if (!token || !accountId) {
      this.logger.warn('Instagram API not configured — INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID missing');
      return { synced: 0, errors: 0 };
    }

    let synced = 0;
    let errors = 0;

    try {
      const url = `https://graph.facebook.com/v25.0/${accountId}/media`;
      const response = await axios.get(url, {
        params: {
          fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
          access_token: token,
          // Pull more than the storefront grid renders — the homepage shows 12
          // tiles but we want older posts' URLs to stay fresh too, so that
          // pinned/manually-promoted older posts don't rot.
          limit: 50,
        },
        timeout: 15000,
      });

      const posts = response.data?.data;
      if (!Array.isArray(posts)) {
        this.logger.warn('Instagram API returned unexpected format');
        return { synced: 0, errors: 1 };
      }

      for (const post of posts) {
        try {
          const remoteUrl =
            post.media_type === 'VIDEO'
              ? post.thumbnail_url || post.media_url
              : post.media_url;

          if (!remoteUrl) continue;

          // Mirror the Instagram CDN image to local disk so it survives the
          // ~24h signed-URL expiry. If the download fails we fall back to the
          // remote URL for this cycle — better a temporarily-broken image
          // than losing the post entirely.
          let imageUrl: string;
          try {
            imageUrl = await this.downloadInstagramMedia(remoteUrl, post.id);
          } catch (dlErr) {
            this.logger.warn(
              `Instagram media download failed for ${post.id}, storing remote URL as fallback: ${dlErr instanceof Error ? dlErr.message : dlErr}`,
            );
            imageUrl = remoteUrl;
          }

          await this.prisma.instagramPost.upsert({
            where: { instagramMediaId: post.id },
            update: {
              tenantId,
              caption: post.caption || null,
              imageUrl,
              postUrl: post.permalink || null,
              likes: 0,
              mediaType: post.media_type || null,
              postedAt: post.timestamp ? new Date(post.timestamp) : null,
            },
            create: {
              tenantId,
              instagramMediaId: post.id,
              caption: post.caption || null,
              imageUrl,
              postUrl: post.permalink || null,
              likes: 0,
              mediaType: post.media_type || null,
              postedAt: post.timestamp ? new Date(post.timestamp) : null,
              source: 'INSTAGRAM_API',
              isActive: true,
              sortOrder: 0,
            },
          });
          synced++;
        } catch (err) {
          this.logger.error(`Failed to upsert IG post ${post.id}: ${err instanceof Error ? err.message : err}`);
          errors++;
        }
      }

      this.logger.log(`Instagram sync completed: ${synced} synced, ${errors} errors`);
    } catch (err) {
      this.logger.error(`Instagram API call failed: ${err instanceof Error ? err.message : err}`);
      errors++;
    }

    return { synced, errors };
  }

  /**
   * Download an Instagram CDN media URL to local disk and return a
   * `/uploads/instagram/<mediaId>.<ext>` path that ServeStaticModule will
   * serve. Instagram's `scontent.cdninstagram.com` URLs are signed and
   * expire within ~24h, so hotlinking them results in broken images in
   * the storefront feed — mirroring them locally pins the asset.
   *
   * Idempotent: if the final file already exists we skip the download and
   * return the local path. Failed downloads leave no .part residue because
   * we write to a temp file and atomically rename on success.
   */
  private async downloadInstagramMedia(remoteUrl: string, mediaId: string): Promise<string> {
    // Extract a clean extension from the URL path (stripping query string).
    // Fall back to .jpg — Instagram image media and video thumbnails are
    // always JPEG even when the extension is missing.
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

  /**
   * Refresh the long-lived Instagram access token.
   * Long-lived tokens expire in 60 days; this extends them.
   * The new token is logged — admin must update env var or site setting.
   */
  async refreshAccessToken(): Promise<boolean> {
    const token = this.configService.get<string>('INSTAGRAM_ACCESS_TOKEN', '');
    if (!token) {
      this.logger.warn('No Instagram access token to refresh');
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
        // Store the refreshed token in SiteSetting for persistence
        const existingSetting = await this.prisma.siteSetting.findFirst({
          where: { key: 'instagram_access_token' },
        });
        if (existingSetting) {
          await this.prisma.siteSetting.update({
            where: { id: existingSetting.id },
            data: { value: newToken },
          });
        } else {
          await this.prisma.siteSetting.create({
            data: { key: 'instagram_access_token', value: newToken, type: 'string' },
          });
        }
        this.logger.log('Instagram access token refreshed and stored in site settings');
        return true;
      }

      this.logger.warn('Token refresh response missing access_token');
      return false;
    } catch (err) {
      this.logger.error(`Instagram token refresh failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /**
   * Get the active access token — check SiteSetting first (refreshed token),
   * then fall back to env var.
   */
  async getActiveToken(): Promise<string> {
    try {
      const setting = await this.prisma.siteSetting.findFirst({
        where: { key: 'instagram_access_token' },
      });
      if (setting?.value) return setting.value;
    } catch {
      // Fall back to env var
    }
    return this.configService.get<string>('INSTAGRAM_ACCESS_TOKEN', '');
  }
}
