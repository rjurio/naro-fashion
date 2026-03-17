import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  // --- Banners ---

  async findAllBanners() {
    return this.prisma.banner.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAllBannersAdmin() {
    return this.prisma.banner.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createBanner(dto: CreateBannerDto) {
    return this.prisma.banner.create({ data: dto as any });
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner || banner.deletedAt) throw new NotFoundException('Banner not found');
    return this.prisma.banner.update({ where: { id }, data: dto });
  }

  async deleteBanner(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    await this.prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Banner moved to recycle bin' };
  }

  async restoreBanner(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner || !banner.deletedAt) throw new NotFoundException('Deleted banner not found');
    return this.prisma.banner.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedBanners() {
    return this.prisma.banner.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Pages ---

  async findAllPages() {
    return this.prisma.page.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPageBySlug(slug: string) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    return page;
  }

  async createPage(dto: CreatePageDto) {
    return this.prisma.page.create({ data: dto });
  }

  async updatePage(id: string, dto: UpdatePageDto) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page || page.deletedAt) throw new NotFoundException('Page not found');
    return this.prisma.page.update({ where: { id }, data: dto });
  }

  async deletePage(id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.page.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false },
    });
    return { message: 'Page moved to recycle bin' };
  }

  async restorePage(id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page || !page.deletedAt) throw new NotFoundException('Deleted page not found');
    return this.prisma.page.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async findDeletedPages() {
    return this.prisma.page.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Settings ---

  async findAllSettings() {
    return this.prisma.siteSetting.findMany();
  }

  async updateSetting(key: string, dto: UpdateSettingDto) {
    return this.prisma.siteSetting.upsert({
      where: { key },
      update: { value: dto.value },
      create: { key, value: dto.value },
    });
  }

  async getBusinessProfile() {
    const settings = await this.prisma.siteSetting.findMany();
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
    };
  }

  // --- Hero Slides ---

  async findActiveHeroSlides() {
    return this.prisma.heroSlide.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAllHeroSlidesAdmin() {
    return this.prisma.heroSlide.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createHeroSlide(dto: CreateHeroSlideDto) {
    return this.prisma.heroSlide.create({ data: dto as any });
  }

  async updateHeroSlide(id: string, dto: UpdateHeroSlideDto) {
    const slide = await this.prisma.heroSlide.findUnique({ where: { id } });
    if (!slide || slide.deletedAt) throw new NotFoundException('Hero slide not found');
    return this.prisma.heroSlide.update({ where: { id }, data: dto });
  }

  async deleteHeroSlide(id: string) {
    const slide = await this.prisma.heroSlide.findUnique({ where: { id } });
    if (!slide) throw new NotFoundException('Hero slide not found');
    await this.prisma.heroSlide.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Hero slide moved to recycle bin' };
  }

  async restoreHeroSlide(id: string) {
    const slide = await this.prisma.heroSlide.findUnique({ where: { id } });
    if (!slide || !slide.deletedAt) throw new NotFoundException('Deleted hero slide not found');
    return this.prisma.heroSlide.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedHeroSlides() {
    return this.prisma.heroSlide.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // --- Instagram Posts ---

  async findActiveInstagramPosts() {
    // Ordered: API posts (latest first) → Pinned → Manual (by sortOrder)
    const posts = await this.prisma.instagramPost.findMany({
      where: { isActive: true, deletedAt: null },
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
      where: { deletedAt: null },
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
    return this.prisma.instagramPost.create({ data: dto as any });
  }

  async updateInstagramPost(id: string, dto: UpdateInstagramPostDto) {
    const post = await this.prisma.instagramPost.findUnique({ where: { id } });
    if (!post || post.deletedAt) throw new NotFoundException('Instagram post not found');
    return this.prisma.instagramPost.update({ where: { id }, data: dto });
  }

  async deleteInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Instagram post not found');
    await this.prisma.instagramPost.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Instagram post moved to recycle bin' };
  }

  async restoreInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findUnique({ where: { id } });
    if (!post || !post.deletedAt) throw new NotFoundException('Deleted Instagram post not found');
    return this.prisma.instagramPost.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeletedInstagramPosts() {
    return this.prisma.instagramPost.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async togglePinInstagramPost(id: string) {
    const post = await this.prisma.instagramPost.findUnique({ where: { id } });
    if (!post || post.deletedAt) throw new NotFoundException('Instagram post not found');
    return this.prisma.instagramPost.update({
      where: { id },
      data: { isPinned: !post.isPinned },
    });
  }
}
