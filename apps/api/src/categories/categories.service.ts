import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    const categories = await this.prisma.category.findMany({
      where: { tenantId: this.tenantContext.requireId, parentId: null, deletedAt: null },
      include: {
        children: {
          where: { deletedAt: null },
          include: {
            children: {
              where: { deletedAt: null },
              include: {
                _count: { select: { products: { where: { deletedAt: null } } } },
              },
            },
            _count: { select: { products: { where: { deletedAt: null } } } },
          },
        },
        sizeGuideRef: { select: { id: true, name: true, slug: true } },
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });

    // Collect every category id (parent + all descendants) so we can do one
    // query to pull the newest product image per category.
    const collectIds = (cat: any): string[] => {
      const ids: string[] = [cat.id];
      for (const child of cat.children || []) ids.push(...collectIds(child));
      return ids;
    };
    const allIds = new Set<string>();
    for (const cat of categories) collectIds(cat).forEach((id) => allIds.add(id));

    // One query: the newest product with at least one image, per category.
    const productsWithImages = await this.prisma.product.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        deletedAt: null,
        categoryId: { in: Array.from(allIds) },
        images: { some: {} },
      },
      select: {
        categoryId: true,
        createdAt: true,
        images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const imageByCategoryId = new Map<string, string>();
    for (const p of productsWithImages) {
      if (p.categoryId && !imageByCategoryId.has(p.categoryId) && p.images[0]?.url) {
        imageByCategoryId.set(p.categoryId, p.images[0].url);
      }
    }

    // Recursively attach fallbackImageUrl (first product image from this
    // category or any descendant) and totalProductCount (direct +
    // descendant products). Parent categories like Wedding Dresses have
    // no direct products but their subcategories (Ball Gown, Mermaid,
    // Plus-Size, etc) do — totalProductCount rolls them up so the
    // storefront can display "14 items" and a real gown photo instead
    // of showing the category as empty.
    const attachFallback = (cat: any): any => {
      const children = (cat.children || []).map(attachFallback);
      let fallbackImageUrl: string | null = imageByCategoryId.get(cat.id) || null;
      if (!fallbackImageUrl) {
        for (const child of children) {
          if (child.fallbackImageUrl) {
            fallbackImageUrl = child.fallbackImageUrl;
            break;
          }
        }
      }
      const directCount = cat._count?.products ?? 0;
      const descendantCount = children.reduce(
        (sum: number, c: any) => sum + (c.totalProductCount ?? 0),
        0,
      );
      const totalProductCount = directCount + descendantCount;
      return { ...cat, children, fallbackImageUrl, totalProductCount };
    };

    return categories.map(attachFallback);
  }

  /**
   * PUBLIC category-by-slug lookup. Wired to `@Public() @Get(':slug')`
   * in CategoriesController — anonymous storefront visitors hit this.
   *
   * Filters MUST happen in the WHERE clause, not after the fetch. Pre-fix,
   * this method matched on (slug, tenantId) only and post-checked
   * `category.deletedAt` — categories with `isActive: false` (admin-
   * deactivated) were silently publicly reachable by direct URL. Audit
   * surfaced this 2026-06-15 alongside the same pattern in
   * `findPageBySlug` (fixed in the same commit) and earlier products +
   * size-guides + sizes (Phase 2 hotfix).
   *
   * Admin endpoints use the unfiltered category tree (deactivated
   * categories visible in the admin tree) so admins can re-activate them.
   * Children are still filtered by `deletedAt: null` AND `isActive: true`
   * so we don't leak deactivated subcategories through the include.
   */
  async findBySlug(slug: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        slug,
        tenantId: this.tenantContext.requireId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        children: { where: { deletedAt: null, isActive: true } },
        parent: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const cat = await this.prisma.category.create({
      data: {
        ...dto,
        slug,
        tenantId: this.tenantContext.requireId,
      },
    });
    await this.auditService.log('CREATE', 'Category', cat.id, { name: dto.name });
    return cat;
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

    const updated = await this.prisma.category.update({
      where: { id },
      data,
    });
    await this.auditService.log('UPDATE', 'Category', id);
    return updated;
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
    await this.auditService.log('DELETE', 'Category', id);
    return { message: 'Category moved to recycle bin' };
  }

  async restore(id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!category || !category.deletedAt) {
      throw new NotFoundException('Deleted category not found');
    }

    const restored = await this.prisma.category.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
    await this.auditService.log('RESTORE', 'Category', id);
    return restored;
  }

  async findDeleted() {
    return this.prisma.category.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }
}
