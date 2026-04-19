import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductsDto, SortOrder } from './dto/query-products.dto';

const sizeGuideSelect = { id: true, name: true, nameSwahili: true, slug: true, content: true, contentSwahili: true, pdfUrl: true, pdfUrlSwahili: true };

const productIncludes = {
  category: {
    select: { id: true, name: true, slug: true, sizeGuideId: true, sizeGuideRef: { select: sizeGuideSelect } },
  },
  variants: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
  sizeGuideRef: { select: sizeGuideSelect },
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: QueryProductsDto) {
    const { search, categoryId, categorySlug, availability_mode, minPrice, maxPrice, sort, page = 1, limit = 20 } = query;

    const where: any = { tenantId: this.tenantContext.requireId, isActive: true, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const categoryIds = await this.resolveCategoryIds({ categoryId, categorySlug });
    if (categoryIds !== null) {
      if (categoryIds.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      where.categoryId = categoryIds.length === 1 ? categoryIds[0] : { in: categoryIds };
    }

    if (availability_mode) {
      const modes = availability_mode.split(',').map((m) => m.trim());
      where.availabilityMode = { in: modes };
    }

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
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          variants: { where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
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
    const { search, categoryId, categorySlug, minPrice, maxPrice, sort, page = 1, limit = 20 } = query;

    const where: any = { tenantId: this.tenantContext.requireId, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const categoryIds = await this.resolveCategoryIds({ categoryId, categorySlug });
    if (categoryIds !== null) {
      if (categoryIds.length === 0) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      where.categoryId = categoryIds.length === 1 ? categoryIds[0] : { in: categoryIds };
    }

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
    const product = await this.prisma.product.findFirst({
      where: { slug, tenantId: this.tenantContext.requireId },
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
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
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
      tenantId: this.tenantContext.requireId,
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
      sizeGuideId: dto.sizeGuideId || undefined,
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

    const product = await this.prisma.product.create({
      data,
      include: productIncludes,
    });
    await this.auditService.log('CREATE', 'Product', product.id, { name: dto.name });
    return product;
  }

  /**
   * Parse a CSV buffer into rows of {header: value} objects.
   * Handles quoted fields, escaped quotes (""), and CRLF/LF line endings.
   */
  private parseCsv(buffer: Buffer): Record<string, string>[] {
    const text = buffer.toString('utf-8').replace(/^\uFEFF/, ''); // strip BOM
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { currentField += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { currentField += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { currentRow.push(currentField); currentField = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          currentRow.push(currentField);
          if (currentRow.some((f) => f.trim() !== '')) rows.push(currentRow);
          currentRow = [];
          currentField = '';
        }
        else { currentField += c; }
      }
    }
    if (currentField !== '' || currentRow.length) {
      currentRow.push(currentField);
      if (currentRow.some((f) => f.trim() !== '')) rows.push(currentRow);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
      return obj;
    });
  }

  async bulkImport(fileBuffer: Buffer) {
    const tenantId = this.tenantContext.requireId;
    const rows = this.parseCsv(fileBuffer);

    if (rows.length === 0) {
      return { created: 0, failed: 0, total: 0, errors: [{ row: 0, message: 'CSV file is empty or has no data rows' }] };
    }

    if (rows.length > 500) {
      return { created: 0, failed: 0, total: rows.length, errors: [{ row: 0, message: 'Maximum 500 rows per import. Please split your file.' }] };
    }

    // Pre-load all categories for slug → id resolution
    const categories = await this.prisma.category.findMany({
      where: { tenantId, isActive: true, deletedAt: null },
      select: { id: true, slug: true, name: true },
    });
    const categoryBySlug = new Map(categories.map((c) => [c.slug.toLowerCase(), c.id]));
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    // Pre-load existing SKUs to catch duplicates
    const existingProducts = await this.prisma.product.findMany({
      where: { tenantId, deletedAt: null, sku: { not: null } },
      select: { sku: true },
    });
    const existingSkus = new Set(existingProducts.map((p) => p.sku!.toLowerCase()));

    const errors: { row: number; field?: string; message: string }[] = [];
    let created = 0;

    const parseBool = (v: string, def = true): boolean => {
      if (!v) return def;
      const lower = v.toLowerCase();
      return lower === 'true' || lower === '1' || lower === 'yes';
    };

    const parseNum = (v: string): number | undefined => {
      if (!v?.trim()) return undefined;
      const n = Number(v);
      return isNaN(n) ? undefined : n;
    };

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const rowNum = idx + 2; // +1 for header, +1 for 1-indexed

      try {
        // Required fields
        const name = row.name?.trim();
        const description = row.description?.trim();
        const priceRaw = row.price?.trim();
        const categoryRaw = (row.categorySlug || row.category || '').trim().toLowerCase();

        if (!name) { errors.push({ row: rowNum, field: 'name', message: 'Name is required' }); continue; }
        if (!description) { errors.push({ row: rowNum, field: 'description', message: 'Description is required' }); continue; }
        if (!priceRaw) { errors.push({ row: rowNum, field: 'price', message: 'Price is required' }); continue; }
        if (!categoryRaw) { errors.push({ row: rowNum, field: 'categorySlug', message: 'Category slug is required' }); continue; }

        const price = Number(priceRaw);
        if (isNaN(price) || price < 0) {
          errors.push({ row: rowNum, field: 'price', message: `Invalid price "${priceRaw}"` });
          continue;
        }

        // Resolve category
        const categoryId = categoryBySlug.get(categoryRaw) || categoryByName.get(categoryRaw);
        if (!categoryId) {
          errors.push({ row: rowNum, field: 'categorySlug', message: `Category "${row.categorySlug || row.category}" not found. Create it first or check spelling.` });
          continue;
        }

        // Validate availability mode
        const availabilityMode = (row.availabilityMode?.trim().toUpperCase() || 'PURCHASE_ONLY');
        if (!['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH'].includes(availabilityMode)) {
          errors.push({ row: rowNum, field: 'availabilityMode', message: `Invalid availability mode "${availabilityMode}". Use PURCHASE_ONLY, RENTAL_ONLY, or BOTH.` });
          continue;
        }

        // SKU uniqueness (check both pre-loaded set and in-batch)
        const sku = row.sku?.trim() || undefined;
        if (sku && existingSkus.has(sku.toLowerCase())) {
          errors.push({ row: rowNum, field: 'sku', message: `SKU "${sku}" already exists` });
          continue;
        }

        // Build DTO
        const dto: CreateProductDto = {
          name,
          nameSwahili: row.nameSwahili?.trim() || undefined,
          description,
          descriptionSwahili: row.descriptionSwahili?.trim() || undefined,
          price,
          compareAtPrice: parseNum(row.compareAtPrice),
          categoryId,
          sku,
          availabilityMode,
          isFeatured: parseBool(row.isFeatured, false),
          published: parseBool(row.published, true),
          rentalPricePerDay: parseNum(row.rentalPricePerDay),
          rentalDepositAmount: parseNum(row.rentalDepositAmount),
          minRentalDays: parseNum(row.minRentalDays),
          maxRentalDays: parseNum(row.maxRentalDays),
        };

        // Optional stock (creates a default variant)
        const stock = parseNum(row.stock);
        if (stock !== undefined && stock > 0) {
          dto.variants = [{ name: 'Default', price, stock }];
        }

        // Optional images (semicolon-separated URLs)
        const imagesRaw = row.imageUrls?.trim();
        if (imagesRaw) {
          dto.images = imagesRaw.split(';').map((u) => u.trim()).filter(Boolean);
        }

        await this.create(dto);

        if (sku) existingSkus.add(sku.toLowerCase());
        created++;
      } catch (err: any) {
        errors.push({ row: rowNum, message: err?.message || 'Unknown error' });
      }
    }

    return {
      created,
      failed: errors.length,
      total: rows.length,
      errors,
    };
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
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
    if (dto.sizeGuideId !== undefined) data.sizeGuideId = dto.sizeGuideId || null;
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

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: productIncludes,
    });
    await this.auditService.log('UPDATE', 'Product', id, { name: dto.name });
    return updated;
  }

  async toggleActive(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    const toggled = await this.prisma.product.update({
      where: { id },
      data: { isActive: !product.isActive },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
    });
    await this.auditService.log('TOGGLE_ACTIVE', 'Product', id);
    return toggled;
  }

  async delete(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.auditService.log('DELETE', 'Product', id);
    return { message: 'Product moved to recycle bin' };
  }

  async restore(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!product || !product.deletedAt) {
      throw new NotFoundException('Deleted product not found');
    }

    const restored = await this.prisma.product.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.auditService.log('RESTORE', 'Product', id);
    return restored;
  }

  async findDeleted() {
    return this.prisma.product.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      include: {
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async permanentDelete(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.delete({ where: { id } });
    await this.auditService.log('PERMANENT_DELETE', 'Product', id);
    return { message: 'Product permanently deleted' };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);
  }

  /**
   * Resolve a categoryId/categorySlug filter into the full set of category IDs
   * to match. Categories are hierarchical — clicking a parent like "Men" must
   * fan out to its children (shirts, trousers, jeans, etc.) because parents
   * typically have no direct products.
   *
   * Returns null when no category filter was supplied (caller should not add
   * a categoryId clause). Returns [] when the slug didn't resolve (caller
   * should short-circuit to an empty result).
   */
  private async resolveCategoryIds(opts: { categoryId?: string; categorySlug?: string }): Promise<string[] | null> {
    const tenantId = this.tenantContext.requireId;
    let rootId: string | null = null;

    if (opts.categoryId) {
      rootId = opts.categoryId;
    } else if (opts.categorySlug) {
      const cat = await this.prisma.category.findFirst({
        where: { tenantId, slug: opts.categorySlug, deletedAt: null },
        select: { id: true },
      });
      if (!cat) return [];
      rootId = cat.id;
    } else {
      return null;
    }

    const ids: string[] = [rootId];
    let frontier: string[] = [rootId];
    while (frontier.length) {
      const kids = await this.prisma.category.findMany({
        where: { tenantId, deletedAt: null, parentId: { in: frontier } },
        select: { id: true },
      });
      if (!kids.length) break;
      const nextIds = kids.map((k) => k.id);
      ids.push(...nextIds);
      frontier = nextIds;
    }
    return ids;
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
