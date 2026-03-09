import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto, SortOrder } from './dto/query-products.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryProductsDto) {
    const { search, categoryId, minPrice, maxPrice, sort, page = 1, limit = 20 } = query;

    const where: any = { isActive: true };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {};
      if (minPrice !== undefined) where.basePrice.gte = minPrice;
      if (maxPrice !== undefined) where.basePrice.lte = maxPrice;
    }

    let orderBy: any = { createdAt: 'desc' };
    switch (sort) {
      case SortOrder.PRICE_ASC:
        orderBy = { basePrice: 'asc' };
        break;
      case SortOrder.PRICE_DESC:
        orderBy = { basePrice: 'desc' };
        break;
      case SortOrder.NEWEST:
        orderBy = { createdAt: 'desc' };
        break;
      case SortOrder.OLDEST:
        orderBy = { createdAt: 'asc' };
        break;
      case SortOrder.NAME_ASC:
        orderBy = { name: 'asc' };
        break;
      case SortOrder.NAME_DESC:
        orderBy = { name: 'desc' };
        break;
    }

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { firstName: true, lastName: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(dto: CreateProductDto) {
    const slug = this.generateSlug(dto.name);

    return this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        basePrice: dto.price,
        compareAtPrice: dto.compareAtPrice,
        categoryId: dto.categoryId,
        sku: dto.sku,
        slug,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const data: any = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = this.generateSlug(dto.name);
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.basePrice = dto.price;
    if (dto.compareAtPrice !== undefined) data.compareAtPrice = dto.compareAtPrice;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.sku !== undefined) data.sku = dto.sku;

    return this.prisma.product.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product deleted' };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);
  }
}
