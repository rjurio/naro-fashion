import { Prisma } from '@prisma/client';
import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto';

function stockStatus(total: number, minimum: number): string {
  if (total === 0) return 'OUT';
  if (total < minimum) return 'LOW';
  return 'OK';
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async getInventoryList(params: { status?: string; search?: string }) {
    const { status, search } = params;
    const products = await this.prisma.product.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
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
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
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
    const where: any = { tenantId: this.tenantContext.requireId, productId, ...(type ? { type } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async updateSettings(productId: string, dto: UpdateInventorySettingsDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantContext.requireId } });
    if (!product) throw new NotFoundException('Product not found');
    const select = { id: true, name: true, purchasePrice: true, minimumStock: true, supplierName: true, supplierContact: true };
    const before = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantContext.requireId }, select });
    await this.prisma.product.updateMany({ where: { id: productId, tenantId: this.tenantContext.requireId }, data: { ...dto } });
    const after = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantContext.requireId }, select });
    await this.auditService.log('UPDATE_INVENTORY_SETTINGS', 'Inventory', productId, { before, after });
    return after;
  }

  async adjustStock(dto: AdjustStockDto, performedBy?: string) {
    const tenantId = this.tenantContext.requireId;
    const OUTBOUND = ['DAMAGE', 'SALE', 'RENTAL_OUT'];
    const sign = OUTBOUND.includes(dto.type) ? -1 : 1;
    const quantityChange = sign * dto.quantity;

    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    const unitCost = Number(product.purchasePrice ?? 0);

    // Resolve an UNAMBIGUOUS target variant. A product-level adjustment
    // (no variantId) is only meaningful when the product has exactly one
    // variant. Previously the no-variantId path wrote a ledger row but never
    // updated any variant's stock (the `if (variantId)` had no else), so the
    // audit/valuation ledger silently diverged from reality.
    let targetVariantId = dto.variantId;
    if (!targetVariantId) {
      const variants = await this.prisma.productVariant.findMany({
        where: { productId: dto.productId, tenantId },
        select: { id: true },
      });
      if (variants.length === 0) {
        throw new BadRequestException('Product has no variants to adjust. Add a variant first.');
      }
      if (variants.length > 1) {
        throw new BadRequestException(
          'This product has multiple variants — specify which variantId to adjust.',
        );
      }
      targetVariantId = variants[0].id;
    }

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: targetVariantId, tenantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    // Security fix: one transaction, tenant-scoped, atomic and guarded —
    // a decrease never takes stock below 0, an optional expectedStock refuses
    // a stale read, and the ledger's before/after come from inside the
    // transaction (they were read before it, so concurrent adjustments
    // recorded wrong values).
    const result = await this.prisma.$transaction(async (tx) => {
      const where: Prisma.ProductVariantWhereInput = {
        id: targetVariantId, tenantId,
        ...(dto.expectedStock !== undefined ? { stock: dto.expectedStock } : quantityChange < 0 ? { stock: { gte: -quantityChange } } : {}),
      };
      if (dto.expectedStock !== undefined && dto.expectedStock + quantityChange < 0) {
        throw new ConflictException({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Stock cannot go below 0.' });
      }
      const res = await tx.productVariant.updateMany({ where, data: { stock: { increment: quantityChange } } });
      if (res.count !== 1) {
        const now = await tx.productVariant.findFirst({ where: { id: targetVariantId, tenantId }, select: { stock: true } });
        if (dto.expectedStock !== undefined && now && now.stock !== dto.expectedStock) {
          throw new ConflictException({ statusCode: 409, code: 'STALE_STOCK', current: now.stock, message: `Stock changed meanwhile (now ${now.stock}). Reload and try again.` });
        }
        throw new ConflictException({ statusCode: 409, code: 'INSUFFICIENT_STOCK', current: now?.stock ?? null, message: 'Stock cannot go below 0.' });
      }
      const after = await tx.productVariant.findFirst({ where: { id: targetVariantId, tenantId }, select: { stock: true } });
      const quantityAfter = after!.stock;
      const quantityBefore = quantityAfter - quantityChange;

      if (dto.type === 'RESTOCK') {
        await tx.product.updateMany({ where: { id: dto.productId, tenantId }, data: { lastRestockedAt: new Date() } });
      }

      return tx.inventoryTransaction.create({
        data: {
          tenantId,
          productId: dto.productId,
          variantId: targetVariantId,
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
    await this.auditService.log('ADJUST_STOCK', 'Inventory', dto.productId, {
      variantId: targetVariantId, type: dto.type, quantityChange,
      before: result.quantityBefore, after: result.quantityAfter, note: dto.note ?? null, transactionId: result.id,
    });
    return result;
  }
}
