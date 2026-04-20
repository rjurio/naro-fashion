import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';

export class CreateFlashSaleDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsNumber() @Min(0) @Type(() => Number) salePrice: number;
  @IsArray() @IsString({ each: true }) productIds: string[];
}

export class UpdateFlashSaleDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) salePrice?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[];
}

@Injectable()
export class FlashSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async findAllActive() {
    const now = new Date();
    return this.prisma.flashSale.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        startDate: { lte: now },
        endDate: { gte: now },
        deletedAt: null,
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                basePrice: true,
                images: true,
              },
            },
          },
        },
      },
      orderBy: { endDate: 'asc' },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.flashSale.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                basePrice: true,
                images: true,
              },
            },
          },
        },
      },
    });

    if (!sale) throw new NotFoundException('Flash sale not found');
    return sale;
  }

  async create(dto: CreateFlashSaleDto) {
    const { productIds, startDate, endDate, salePrice, ...rest } = dto;

    const sale = await this.prisma.flashSale.create({
      data: {
        tenantId: this.tenantContext.requireId,
        ...rest,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        items: {
          create: productIds.map((productId) => ({
            productId,
            salePrice,
          })),
        },
      },
      include: { items: true },
    });
    await this.auditService.log('CREATE', 'FlashSale', sale.id, { title: dto.title });
    return sale;
  }

  async update(id: string, dto: UpdateFlashSaleDto) {
    const sale = await this.prisma.flashSale.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!sale) throw new NotFoundException('Flash sale not found');

    const { productIds, startDate, endDate, salePrice, ...rest } = dto;
    const data: any = { ...rest };

    if (startDate) data.startDate = new Date(startDate);
    if (endDate) data.endDate = new Date(endDate);

    if (productIds) {
      // Replace all items
      await this.prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } });
      data.items = {
        create: productIds.map((productId) => ({
          productId,
          salePrice: salePrice ?? 0,
        })),
      };
    }

    const updated = await this.prisma.flashSale.update({
      where: { id },
      data,
      include: { items: true },
    });
    await this.auditService.log('UPDATE', 'FlashSale', id);
    return updated;
  }

  async delete(id: string) {
    const sale = await this.prisma.flashSale.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!sale) throw new NotFoundException('Flash sale not found');

    await this.prisma.flashSale.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.auditService.log('DELETE', 'FlashSale', id);

    return { message: 'Flash sale moved to recycle bin' };
  }

  async restore(id: string) {
    const sale = await this.prisma.flashSale.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!sale || !sale.deletedAt) throw new NotFoundException('Deleted flash sale not found');

    const restored = await this.prisma.flashSale.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
      include: { items: true },
    });
    await this.auditService.log('RESTORE', 'FlashSale', id);
    return restored;
  }

  async findDeleted() {
    return this.prisma.flashSale.findMany({
      where: { deletedAt: { not: null }, tenantId: this.tenantContext.requireId },
      include: { items: true },
      orderBy: { deletedAt: 'desc' },
    });
  }
}
