import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class CreateBannerDto {
  title: string;
  imageUrl: string;
  linkUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class UpdateBannerDto {
  title?: string;
  imageUrl?: string;
  linkUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export class CreatePageDto {
  title: string;
  slug: string;
  content: string;
  isPublished?: boolean;
}

export class UpdatePageDto {
  title?: string;
  slug?: string;
  content?: string;
  isPublished?: boolean;
}

export class UpdateSettingDto {
  value: string;
}

@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Banners ---

  async findAllBanners() {
    return this.prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createBanner(dto: CreateBannerDto) {
    return this.prisma.banner.create({ data: dto });
  }

  async updateBanner(id: string, dto: UpdateBannerDto) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return this.prisma.banner.update({ where: { id }, data: dto });
  }

  async deleteBanner(id: string) {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    await this.prisma.banner.delete({ where: { id } });
    return { message: 'Banner deleted' };
  }

  // --- Pages ---

  async findAllPages() {
    return this.prisma.page.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, slug: true, isPublished: true, createdAt: true },
    });
  }

  async findPageBySlug(slug: string) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async createPage(dto: CreatePageDto) {
    return this.prisma.page.create({ data: dto });
  }

  async updatePage(id: string, dto: UpdatePageDto) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page) throw new NotFoundException('Page not found');
    return this.prisma.page.update({ where: { id }, data: dto });
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
}
