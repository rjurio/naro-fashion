import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto, SortOrder } from './dto/query-products.dto';

const productIncludes = {
  category: { select: { id: true, name: true, slug: true } },
  variants: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryProductsDto) {
    const { search, categoryId, minPrice, maxPrice, sort, page = 1, limit = 20 } = query;

    const where: any = { isActive: true, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) where.categoryId = categoryId;

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {};
      if (minPrice !== undefined) where.basePrice.gte = minPrice;
      if (maxPrice !== undefined) where.basePrice.lte = maxPrice;
    }

    const orderBy = this.getSortOrder(sort);
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
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAllAdmin(query: QueryProductsDto) {
    const { search, categoryId, minPrice, maxPrice, sort, page = 1, limit = 20 } = query;

    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId) where.categoryId = categoryId;

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {};
      if (minPrice !== undefined) where.basePrice.gte = minPrice;
      if (maxPrice !== undefined) where.basePrice.lte = maxPrice;
    }

    const orderBy = this.getSortOrder(sort);
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          variants: { select: { id: true, name: true, sku: true, barcode: true, size: true, color: true, colorHex: true, price: true, stock: true, isActive: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        ...productIncludes,
        reviews: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { firstName: true, lastName: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productIncludes,
    });

    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(dto: CreateProductDto) {
    const slug = dto.slug || this.generateSlug(dto.name);

    const data: any = {
      name: dto.name,
      nameSwahili: dto.nameSwahili,
      slug,
      description: dto.description,
      descriptionSwahili: dto.descriptionSwahili,
      basePrice: dto.price,
      compareAtPrice: dto.compareAtPrice,
      categoryId: dto.categoryId,
      sku: dto.sku,
      availabilityMode: dto.availabilityMode || 'PURCHASE_ONLY',
      isFeatured: dto.isFeatured ?? false,
      isActive: dto.published !== false,
      rentalPricePerDay: dto.rentalPricePerDay,
      rentalDepositAmount: dto.rentalDepositAmount,
      minRentalDays: dto.minRentalDays,
      maxRentalDays: dto.maxRentalDays,
      bufferDaysOverride: dto.bufferDaysOverride,
    };

    if (dto.variants?.length) {
      data.variants = {
        create: dto.variants.map((v, i) => ({
          name: v.name,
          sku: v.sku || `${slug}-v${i + 1}`,
          barcode: v.barcode || undefined,
          size: v.size,
          color: v.color,
          colorHex: v.colorHex,
          price: v.price,
          stock: v.stock ?? 0,
        })),
      };
    }

    if (dto.images?.length) {
      data.images = {
        create: dto.images.map((url, i) => ({
          url,
          sortOrder: i,
          isPrimary: i === 0,
        })),
      };
    }

    return this.prisma.product.create({
      data,
      include: productIncludes,
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    const data: any = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = this.generateSlug(dto.name);
    }
    if (dto.nameSwahili !== undefined) data.nameSwahili = dto.nameSwahili;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.descriptionSwahili !== undefined) data.descriptionSwahili = dto.descriptionSwahili;
    if (dto.price !== undefined) data.basePrice = dto.price;
    if (dto.compareAtPrice !== undefined) data.compareAtPrice = dto.compareAtPrice;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.availabilityMode !== undefined) data.availabilityMode = dto.availabilityMode;
    if (dto.isFeatured !== undefined) data.isFeatured = dto.isFeatured;
    if (dto.published !== undefined) data.isActive = dto.published;
    if (dto.rentalPricePerDay !== undefined) data.rentalPricePerDay = dto.rentalPricePerDay;
    if (dto.rentalDepositAmount !== undefined) data.rentalDepositAmount = dto.rentalDepositAmount;
    if (dto.minRentalDays !== undefined) data.minRentalDays = dto.minRentalDays;
    if (dto.maxRentalDays !== undefined) data.maxRentalDays = dto.maxRentalDays;
    if (dto.bufferDaysOverride !== undefined) data.bufferDaysOverride = dto.bufferDaysOverride;
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.minimumStock !== undefined) data.minimumStock = dto.minimumStock;
    if (dto.supplierName !== undefined) data.supplierName = dto.supplierName;
    if (dto.supplierContact !== undefined) data.supplierContact = dto.supplierContact;

    // Handle variants: delete all existing, re-create from dto
    if (dto.variants !== undefined) {
      await this.prisma.productVariant.deleteMany({ where: { productId: id } });
      if (dto.variants.length > 0) {
        await this.prisma.productVariant.createMany({
          data: dto.variants.map((v, i) => ({
            productId: id,
            name: v.name,
            sku: v.sku || `${product.slug}-v${i + 1}-${Date.now().toString(36)}`,
            barcode: v.barcode || undefined,
            size: v.size,
            color: v.color,
            colorHex: v.colorHex,
            price: v.price,
            stock: v.stock ?? 0,
          })),
        });
      }
    }

    // Handle images: delete all existing, re-create from dto
    if (dto.images !== undefined) {
      await this.prisma.productImage.deleteMany({ where: { productId: id } });
      if (dto.images.length > 0) {
        await this.prisma.productImage.createMany({
          data: dto.images.map((url, i) => ({
            productId: id,
            url,
            sortOrder: i,
            isPrimary: i === 0,
          })),
        });
      }
    }

    return this.prisma.product.update({
      where: { id },
      data,
      include: productIncludes,
    });
  }

  async toggleActive(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async delete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Product moved to recycle bin' };
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || !product.deletedAt) {
      throw new NotFoundException('Deleted product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async findDeleted() {
    return this.prisma.product.findMany({
      where: { deletedAt: { not: null } },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async permanentDelete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.delete({ where: { id } });
    return { message: 'Product permanently deleted' };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);
  }

  private getSortOrder(sort?: SortOrder): any {
    switch (sort) {
      case SortOrder.PRICE_ASC: return { basePrice: 'asc' };
      case SortOrder.PRICE_DESC: return { basePrice: 'desc' };
      case SortOrder.NEWEST: return { createdAt: 'desc' };
      case SortOrder.OLDEST: return { createdAt: 'asc' };
      case SortOrder.NAME_ASC: return { name: 'asc' };
      case SortOrder.NAME_DESC: return { name: 'desc' };
      default: return { createdAt: 'desc' };
    }
  }
}
