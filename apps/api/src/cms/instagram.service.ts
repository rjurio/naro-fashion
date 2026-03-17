import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

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
   */
  async syncFromInstagram(): Promise<{ synced: number; errors: number }> {
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
          limit: 12,
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
          const imageUrl =
            post.media_type === 'VIDEO'
              ? post.thumbnail_url || post.media_url
              : post.media_url;

          if (!imageUrl) continue;

          await this.prisma.instagramPost.upsert({
            where: { instagramMediaId: post.id },
            update: {
              caption: post.caption || null,
              imageUrl,
              postUrl: post.permalink || null,
              likes: 0,
              mediaType: post.media_type || null,
              postedAt: post.timestamp ? new Date(post.timestamp) : null,
            },
            create: {
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
        await this.prisma.siteSetting.upsert({
          where: { key: 'instagram_access_token' },
          update: { value: newToken },
          create: { key: 'instagram_access_token', value: newToken, type: 'string' },
        });
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
      const setting = await this.prisma.siteSetting.findUnique({
        where: { key: 'instagram_access_token' },
      });
      if (setting?.value) return setting.value;
    } catch {
      // Fall back to env var
    }
    return this.configService.get<string>('INSTAGRAM_ACCESS_TOKEN', '');
  }
}
