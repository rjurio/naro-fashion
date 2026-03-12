import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';

function stockStatus(total: number, minimum: number): string {
  if (total === 0) return 'OUT';
  if (total < minimum) return 'LOW';
  return 'OK';
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventoryList(params: { status?: string; search?: string }) {
    const { status, search } = params;
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true, name: true, sku: true, basePrice: true, purchasePrice: true,
        minimumStock: true, supplierName: true, supplierContact: true, lastRestockedAt: true,
        isActive: true,
        category: { select: { id: true, name: true } },
        variants: { select: { id: true, name: true, stock: true, isActive: true } },
      },
      orderBy: { name: 'asc' },
    });

    const result = products.map(p => {
      const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
      const purchasePrice = Number(p.purchasePrice ?? 0);
      const retailPrice = Number(p.basePrice);
      const profitMargin = purchasePrice > 0 ? ((retailPrice - purchasePrice) / retailPrice * 100).toFixed(1) : null;
      const ss = stockStatus(totalStock, p.minimumStock);
      return { ...p, totalStock, profitMargin, stockStatus: ss };
    });

    if (status) return result.filter(r => r.stockStatus === status);
    return result;
  }

  async getLowStock() {
    return this.getInventoryList({ status: 'LOW' });
  }

  async getValuation() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, basePrice: true, purchasePrice: true,
        variants: { select: { stock: true } },
      },
    });

    let costValue = 0;
    let retailValue = 0;
    const rows = products.map(p => {
      const totalStock = p.variants.reduce((sum, v) => sum + v.stock, 0);
      const purchase = Number(p.purchasePrice ?? 0);
      const retail = Number(p.basePrice);
      const totalCost = purchase * totalStock;
      const totalRetail = retail * totalStock;
      costValue += totalCost;
      retailValue += totalRetail;
      const margin = purchase > 0 && retail > 0 ? ((retail - purchase) / retail * 100).toFixed(1) : null;
      return { id: p.id, name: p.name, totalStock, purchasePrice: purchase, retailPrice: retail, totalCost, totalRetail, profitMargin: margin };
    });

    return { costValue, retailValue, unrealizedProfit: retailValue - costValue, products: rows };
  }

  async getTransactions(productId: string, params: { page?: number; limit?: number; type?: string }) {
    const { page = 1, limit = 50, type } = params;
    const where: any = { productId, ...(type ? { type } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async updateSettings(productId: string, dto: UpdateInventorySettingsDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.product.update({
      where: { id: productId },
      data: { ...dto },
      select: { id: true, name: true, purchasePrice: true, minimumStock: true, supplierName: true, supplierContact: true },
    });
  }

  async adjustStock(dto: AdjustStockDto, performedBy?: string) {
    const OUTBOUND = ['DAMAGE', 'SALE', 'RENTAL_OUT'];
    const sign = OUTBOUND.includes(dto.type) ? -1 : 1;
    const quantityChange = sign * dto.quantity;

    // Get current stock
    let quantityBefore = 0;
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findUnique({ where: { id: dto.variantId } });
      if (!variant) throw new NotFoundException('Variant not found');
      quantityBefore = variant.stock;
    } else {
      const agg = await this.prisma.productVariant.aggregate({
        where: { productId: dto.productId },
        _sum: { stock: true },
      });
      quantityBefore = agg._sum.stock ?? 0;
    }

    const quantityAfter = quantityBefore + quantityChange;
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');
    const unitCost = Number(product.purchasePrice ?? 0);

    return this.prisma.$transaction(async (tx) => {
      // Update variant stock if specified, else update first variant
      if (dto.variantId) {
        await tx.productVariant.update({
          where: { id: dto.variantId },
          data: { stock: { increment: quantityChange } },
        });
      }

      // Update lastRestockedAt if RESTOCK
      if (dto.type === 'RESTOCK') {
        await tx.product.update({ where: { id: dto.productId }, data: { lastRestockedAt: new Date() } });
      }

      // Create transaction record
      return tx.inventoryTransaction.create({
        data: {
          productId: dto.productId,
          variantId: dto.variantId,
          type: dto.type,
          quantityBefore,
          quantityChange,
          quantityAfter,
          unitCost: unitCost || null,
          totalValue: unitCost ? unitCost * Math.abs(quantityChange) : null,
          note: dto.note,
          reference: dto.reference,
          performedBy,
        },
      });
    });
  }
}
