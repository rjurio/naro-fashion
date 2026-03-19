import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async findAll() {
    return this.prisma.category.findMany({
      where: { tenantId: this.tenantContext.requireId, parentId: null, deletedAt: null },
      include: {
        children: {
          where: { deletedAt: null },
          include: {
            children: { where: { deletedAt: null } },
          },
        },
        sizeGuideRef: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({
      where: { slug, tenantId: this.tenantContext.requireId },
      include: {
        children: { where: { deletedAt: null } },
        parent: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!category || category.deletedAt) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return this.prisma.category.create({
      data: {
        ...dto,
        slug,
        tenantId: this.tenantContext.requireId,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!category || category.deletedAt) {
      throw new NotFoundException('Category not found');
    }

    const data: any = { ...dto };
    if (dto.name) {
      data.slug = dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    if (dto.sizeGuideId !== undefined) {
      data.sizeGuideId = dto.sizeGuideId || null;
    }

    return this.prisma.category.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Category moved to recycle bin' };
  }

  async restore(id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!category || !category.deletedAt) {
      throw new NotFoundException('Deleted category not found');
    }

    return this.prisma.category.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeleted() {
    return this.prisma.category.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }
}
