import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString, IsOptional, IsEmail } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';

export class CreateBannerDto {
  title: string;
  titleSwahili?: string;
  subtitle?: string;
  subtitleSwahili?: string;
  imageUrl?: string;
  linkUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class UpdateBannerDto {
  title?: string;
  titleSwahili?: string;
  subtitle?: string;
  subtitleSwahili?: string;
  imageUrl?: string;
  linkUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class CreatePageDto {
  title: string;
  titleSwahili?: string;
  slug: string;
  content: string;
  contentSwahili?: string;
  isPublished?: boolean;
}

export class UpdatePageDto {
  title?: string;
  titleSwahili?: string;
  slug?: string;
  content?: string;
  contentSwahili?: string;
  isPublished?: boolean;
}

export class UpdateSettingDto {
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class CreateHeroSlideDto {
  title?: string;
  imageUrl: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class UpdateHeroSlideDto {
  title?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class CreateInstagramPostDto {
  caption?: string;
  imageUrl: string;
  postUrl?: string;
  likes?: number;
  sortOrder?: number;
  isActive?: boolean;
  isPinned?: boolean;
}

export class SubmitContactDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  message: string;
}

export class UpdateContactStatusDto {
  @IsString()
  status: string; // PENDING, IN_PROGRESS, CLOSED, UNATTENDED
}

export class ReplyContactDto {
  @IsString()
  reply: string;

  @IsOptional()
  @IsString()
  adminId?: string;
}

export class UpdateInstagramPostDto {
  caption?: string;
  imageUrl?: string;
  postUrl?: string;
  likes?: number;
  sortOrder?: number;
  isActive?: boolean;
  isPinned?: boolean;
}

@Injectable()
export class CmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  // --- Banners ---

  async findAllBanners() {
    return this.prisma.banner.findMany({
      where: { tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAllBannersAdmin() {
    return this.prisma.banner.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createBanner(dto: CreateBannerDto) {
    const banner = await this.prisma.banner.create({ data: { ...dto, tenantId: this.tenantContext.requireId } as any });
    await this.auditService.log('CREATE', 'Banner', banner.id, { title: dto.title });
    return banner;
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const banner = await this.prisma.banner.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!banner || banner.deletedAt) throw new NotFoundException('Banner not found');
    const updated = await this.prisma.banner.update({ where: { id }, data: dto });
    await this.auditService.log('UPDATE', 'Banner', id);
    return updated;
  }

  async deleteBanner(id: string) {
    const banner = await this.prisma.banner.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!banner) throw new NotFoundException('Banner not found');
    await this.prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.auditService.log('DELETE', 'Banner', id);
    return { message: 'Banner moved to recycle bin' };
  }

  async restoreBanner(id: string) {
    const banner = await this.prisma.banner.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!banner || !banner.deletedAt) throw new NotFoundException('Deleted banner not found');
    return this.prisma.banner.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedBanners() {
    return this.prisma.banner.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Pages ---

  async findAllPages() {
    return this.prisma.page.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPageBySlug(slug: string) {
    const page = await this.prisma.page.findFirst({ where: { slug, tenantId: this.tenantContext.requireId } });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    return page;
  }

  async createPage(dto: CreatePageDto) {
    const page = await this.prisma.page.create({ data: { ...dto, tenantId: this.tenantContext.requireId } });
    await this.auditService.log('CREATE', 'Page', page.id, { title: dto.title });
    return page;
  }

  async updatePage(id: string, dto: UpdatePageDto) {
    const page = await this.prisma.page.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    const updated = await this.prisma.page.update({ where: { id }, data: dto });
    await this.auditService.log('UPDATE', 'Page', id);
    return updated;
  }

  async deletePage(id: string) {
    const page = await this.prisma.page.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.page.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false },
    });
    await this.auditService.log('DELETE', 'Page', id);
    return { message: 'Page moved to recycle bin' };
  }

  async restorePage(id: string) {
    const page = await this.prisma.page.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!page || !page.deletedAt) throw new NotFoundException('Deleted page not found');
    return this.prisma.page.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async findDeletedPages() {
    return this.prisma.page.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Settings ---

  async findAllSettings() {
    return this.prisma.siteSetting.findMany({
      where: { tenantId: this.tenantContext.requireId },
    });
  }

  async updateSetting(key: string, dto: UpdateSettingDto) {
    const tenantId = this.tenantContext.requireId;
    // Use findFirst + create/update since composite unique requires tenantId
    const existing = await this.prisma.siteSetting.findFirst({
      where: { tenantId, key },
    });
    let result;
    if (existing) {
      result = await this.prisma.siteSetting.update({
        where: { id: existing.id },
        data: { value: dto.value },
      });
    } else {
      result = await this.prisma.siteSetting.create({
        data: { key, value: dto.value, tenantId },
      });
    }
    await this.auditService.log('UPDATE', 'SiteSetting', undefined, { key });
    return result;
  }

  async getBusinessProfile() {
    const settings = await this.prisma.siteSetting.findMany({
      where: { tenantId: this.tenantContext.requireId },
    });
    const map = new Map(settings.map((s) => [s.key, s.value]));
    return {
      businessName: map.get('site_name') || 'Naro Fashion',
      businessNameSw: map.get('site_name_sw') || '',
      tagline: map.get('site_description') || 'Premium Fashion & Clothing in Tanzania',
      taglineSw: map.get('site_description_sw') || '',
      businessType: map.get('business_type') || 'Fashion',
      contactEmail: map.get('contact_email') || 'hello@narofashion.co.tz',
      contactPhone: map.get('contact_phone') || '+255 700 000 000',
      contactAddress: map.get('contact_address') || 'Dar es Salaam, Tanzania',
      contactAddressSw: map.get('contact_address_sw') || '',
      whatsappNumber: map.get('whatsapp_number') || '255759047287',
      instagramUrl: map.get('instagram_url') || 'https://www.instagram.com/narofashion2019/',
      facebookUrl: map.get('facebook_url') || '',
      twitterUrl: map.get('twitter_url') || '',
      tiktokUrl: map.get('tiktok_url') || '',
      logoUrl: map.get('company_logo_url') || '/logo.jpg',
      iconUrl: map.get('company_icon_url') || '/icon.jpg',
      faviconUrl: map.get('company_favicon_url') || '/favicon.jpg',
      domain: map.get('business_domain') || 'narofashion.co.tz',
      currency: map.get('currency') || 'TZS',
      acceptedPaymentMethods: (map.get('accepted_payment_methods') || 'VISA,MASTERCARD,MPESA,TIGOPESA').split(',').map((s) => s.trim()).filter(Boolean),
      mapLatitude: map.get('map_latitude') || '',
      mapLongitude: map.get('map_longitude') || '',
    };
  }

  async getStorefrontStats() {
    const tenantId = this.tenantContext.requireId;

    const [productCount, rentalCount, customerCount] = await Promise.all([
      this.prisma.product.count({
        where: { tenantId, isActive: true, deletedAt: null },
      }),
      this.prisma.product.count({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
          availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
        },
      }),
      this.prisma.user.count({
        where: { tenantId, isActive: true },
      }),
    ]);

    return { productCount, rentalCount, customerCount };
  }

  // --- Instagram Sync Config ---

  async getInstagramSyncConfig() {
    const tenantId = this.tenantContext.requireId;
    const setting = await this.prisma.siteSetting.findFirst({
      where: { tenantId, key: 'instagram_sync_interval' },
    });
    return {
      interval: setting?.value || 'EVERY_6_HOURS',
      options: ['OFF', 'EVERY_HOUR', 'EVERY_3_HOURS', 'EVERY_6_HOURS', 'EVERY_12_HOURS', 'DAILY', 'WEEKLY'],
    };
  }

  async updateInstagramSyncConfig(interval: string) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.siteSetting.findFirst({
      where: { tenantId, key: 'instagram_sync_interval' },
    });
    if (existing) {
      await this.prisma.siteSetting.update({
        where: { id: existing.id },
        data: { value: interval },
      });
    } else {
      await this.prisma.siteSetting.create({
        data: { key: 'instagram_sync_interval', value: interval, type: 'string', tenantId },
      });
    }
    return { interval, message: `Instagram sync interval set to ${interval}` };
  }

  // --- Hero Slides ---

  async findActiveHeroSlides() {
    return this.prisma.heroSlide.findMany({
      where: { tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAllHeroSlidesAdmin() {
    return this.prisma.heroSlide.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createHeroSlide(dto: CreateHeroSlideDto) {
    return this.prisma.heroSlide.create({ data: { ...dto, tenantId: this.tenantContext.requireId } as any });
  }

  async updateHeroSlide(id: string, dto: UpdateHeroSlideDto) {
    const slide = await this.prisma.heroSlide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!slide || slide.deletedAt) throw new NotFoundException('Hero slide not found');
    return this.prisma.heroSlide.update({ where: { id }, data: dto });
  }

  async deleteHeroSlide(id: string) {
    const slide = await this.prisma.heroSlide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!slide) throw new NotFoundException('Hero slide not found');
    await this.prisma.heroSlide.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Hero slide moved to recycle bin' };
  }

  async restoreHeroSlide(id: string) {
    const slide = await this.prisma.heroSlide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!slide || !slide.deletedAt) throw new NotFoundException('Deleted hero slide not found');
    return this.prisma.heroSlide.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedHeroSlides() {
    return this.prisma.heroSlide.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Instagram Posts ---

  async findActiveInstagramPosts() {
    // Ordered: API posts (latest first) → Pinned → Manual (by sortOrder)
    const posts = await this.prisma.instagramPost.findMany({
      where: { tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null },
    });

    return posts.sort((a, b) => {
      const groupA = a.source === 'INSTAGRAM_API' ? 0 : a.isPinned ? 1 : 2;
      const groupB = b.source === 'INSTAGRAM_API' ? 0 : b.isPinned ? 1 : 2;
      if (groupA !== groupB) return groupA - groupB;
      // Within API group: newest first by postedAt
      if (groupA === 0) {
        const dateA = a.postedAt ? a.postedAt.getTime() : 0;
        const dateB = b.postedAt ? b.postedAt.getTime() : 0;
        return dateB - dateA;
      }
      // Within pinned/manual: by sortOrder
      return a.sortOrder - b.sortOrder;
    });
  }

  async findAllInstagramPostsAdmin() {
    const posts = await this.prisma.instagramPost.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
    });

    return posts.sort((a, b) => {
      const groupA = a.source === 'INSTAGRAM_API' ? 0 : a.isPinned ? 1 : 2;
      const groupB = b.source === 'INSTAGRAM_API' ? 0 : b.isPinned ? 1 : 2;
      if (groupA !== groupB) return groupA - groupB;
      if (groupA === 0) {
        const dateA = a.postedAt ? a.postedAt.getTime() : 0;
        const dateB = b.postedAt ? b.postedAt.getTime() : 0;
        return dateB - dateA;
      }
      return a.sortOrder - b.sortOrder;
    });
  }

  async createInstagramPost(dto: CreateInstagramPostDto) {
    return this.prisma.instagramPost.create({ data: { ...dto, tenantId: this.tenantContext.requireId } as any });
  }

  async updateInstagramPost(id: string, dto: UpdateInstagramPostDto) {
    const post = await this.prisma.instagramPost.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!post || post.deletedAt) throw new NotFoundException('Instagram post not found');
    return this.prisma.instagramPost.update({ where: { id }, data: dto });
  }

  async deleteInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!post) throw new NotFoundException('Instagram post not found');
    await this.prisma.instagramPost.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Instagram post moved to recycle bin' };
  }

  async restoreInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!post || !post.deletedAt) throw new NotFoundException('Deleted Instagram post not found');
    return this.prisma.instagramPost.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedInstagramPosts() {
    return this.prisma.instagramPost.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async togglePinInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!post || post.deletedAt) throw new NotFoundException('Instagram post not found');
    return this.prisma.instagramPost.update({
      where: { id },
      data: { isPinned: !post.isPinned },
    });
  }

  // --- Contact Submissions ---

  async submitContact(dto: SubmitContactDto) {
    const db = this.prisma as any;
    const submission = await db.contactSubmission.create({
      data: {
        tenantId: this.tenantContext.requireId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject || 'General Inquiry',
        message: dto.message,
        status: 'PENDING',
      },
    });

    // Send acknowledgement email (non-blocking)
    this.emailService
      .send({
        to: dto.email,
        subject: `We received your message — ${submission.subject}`,
        template: 'contact-acknowledgement',
        context: {
          customerName: dto.name,
          subject: submission.subject,
          message: dto.message,
        },
      })
      .catch(() => {/* swallow — email is best-effort */});

    return { success: true, id: submission.id };
  }

  async findAllContactSubmissions(status?: string) {
    const db = this.prisma as any;
    const where: any = { tenantId: this.tenantContext.requireId };
    if (status) where.status = status;
    return db.contactSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findContactSubmission(id: string) {
    const db = this.prisma as any;
    const sub = await db.contactSubmission.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!sub) throw new NotFoundException('Contact submission not found');
    return sub;
  }

  async updateContactStatus(id: string, dto: UpdateContactStatusDto) {
    await this.findContactSubmission(id);
    const db = this.prisma as any;
    return db.contactSubmission.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async replyToContact(id: string, dto: ReplyContactDto) {
    const sub = await this.findContactSubmission(id);
    const db = this.prisma as any;
    const updated = await db.contactSubmission.update({
      where: { id },
      data: {
        adminReply: dto.reply,
        repliedAt: new Date(),
        repliedById: dto.adminId,
        status: 'CLOSED',
      },
    });

    // Send reply email (non-blocking)
    this.emailService
      .send({
        to: sub.email,
        subject: `Re: ${sub.subject || 'Your inquiry'} — Reply from our team`,
        template: 'contact-reply',
        context: {
          customerName: sub.name,
          subject: sub.subject,
          originalMessage: sub.message,
          reply: dto.reply,
        },
      })
      .catch(() => {/* swallow */});

    return updated;
  }

  async deleteContactSubmission(id: string) {
    await this.findContactSubmission(id);
    const db = this.prisma as any;
    await db.contactSubmission.delete({ where: { id } });
    return { message: 'Contact submission deleted' };
  }

  async getContactSubmissionStats() {
    const db = this.prisma as any;
    const tenantId = this.tenantContext.requireId;
    const [total, pending, inProgress, closed, unattended] = await Promise.all([
      db.contactSubmission.count({ where: { tenantId } }),
      db.contactSubmission.count({ where: { tenantId, status: 'PENDING' } }),
      db.contactSubmission.count({ where: { tenantId, status: 'IN_PROGRESS' } }),
      db.contactSubmission.count({ where: { tenantId, status: 'CLOSED' } }),
      db.contactSubmission.count({ where: { tenantId, status: 'UNATTENDED' } }),
    ]);
    return { total, pending, inProgress, closed, unattended };
  }
}
