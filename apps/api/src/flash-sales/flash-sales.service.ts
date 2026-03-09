import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export class CreateFlashSaleDto {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  salePrice: number;
  productIds: string[];
}

export class UpdateFlashSaleDto {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  salePrice?: number;
  productIds?: string[];
}

@Injectable()
export class FlashSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive() {
    const now = new Date();
    return this.prisma.flashSale.findMany({
      where: {
        startDate: { lte: now },
        endDate: { gte: now },
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
    const sale = await this.prisma.flashSale.findUnique({
      where: { id },
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

    return this.prisma.flashSale.create({
      data: {
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
  }

  async update(id: string, dto: UpdateFlashSaleDto) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id } });
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

    return this.prisma.flashSale.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async delete(id: string) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('Flash sale not found');

    await this.prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } });
    await this.prisma.flashSale.delete({ where: { id } });

    return { message: 'Flash sale deleted' };
  }
}
