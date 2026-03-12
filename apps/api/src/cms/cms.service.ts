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
    return this.prisma.banner.create({ data: dto });
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
      select: { id: true, title: true, slug: true, isPublished: true, createdAt: true },
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
}
