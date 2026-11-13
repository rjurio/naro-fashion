import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { AdjustStockDto, DecideAdjustmentDto } from './dto/adjust-stock.dto';
import { approvalRequired, DecreaseThresholds, directionOf, parseThreshold, THRESHOLD_KEYS } from './adjustment-policy';
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
    // PR #42: tenant-scoped write, audited with before / after.
    const select = { id: true, name: true, purchasePrice: true, minimumStock: true, supplierName: true, supplierContact: true };
    const before = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantContext.requireId }, select });
    await this.prisma.product.updateMany({ where: { id: productId, tenantId: this.tenantContext.requireId }, data: { ...dto } });
    const after = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantContext.requireId }, select });
    await this.auditService.log('UPDATE_INVENTORY_SETTINGS', 'Inventory', productId, { before, after });
    return after;
  }

  /**
   * Manual stock change. Round 25F E:
   *  - increases (RESTOCK, ADJUSTMENT INCREASE) apply at once;
   *  - decreases (DAMAGE, ADJUSTMENT DECREASE) apply at once only within the
   *    shop's owner-set threshold (adjustment-policy.ts); otherwise — and
   *    always while no threshold is set — they become a REQUEST that a
   *    different holder of inventory:approve must approve;
   *  - every applied change is a compare-and-swap on the stock read inside
   *    the transaction (no lost updates, no negative stock), with the
   *    before / after values in the ledger row and the audit log.
   */
  async adjustStock(dto: AdjustStockDto, performedBy?: string) {
    const tenantId = this.tenantContext.requireId;
    const direction = directionOf(dto.type, dto.direction);
    if (dto.direction === 'DECREASE' && dto.type !== 'ADJUSTMENT') {
      throw new BadRequestException('Only an ADJUSTMENT can be a decrease; DAMAGE is always a write-off and RESTOCK an increase.');
    }
    const { product, variant } = await this.resolveTarget(dto.productId, dto.variantId);
    // PR #42: the stock the caller saw; if it changed meanwhile → 409 STALE_STOCK, nothing written.
    if (dto.expectedStock !== undefined && variant.stock !== dto.expectedStock) {
      throw new ConflictException({ statusCode: 409, code: 'STALE_STOCK', current: variant.stock, message: `Stock changed meanwhile (now ${variant.stock}). Reload and try again.` });
    }
    // A RESTOCK of a buy-or-rent gown is the event that makes a SOLD gown
    // rentable again (rentals/rental-sale-guard.ts), so it must say why.
    if (dto.type === 'RESTOCK' && product.availabilityMode === 'BOTH' && (dto.note ?? '').trim().length < 5) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'RESTOCK_REASON_REQUIRED',
        message:
          'Restocking a buy-or-rent item makes it available to rent again. Add a note saying where the item came from (at least 5 characters).',
      });
    }
    if (direction === 'DECREASE') {
      if ((dto.note ?? '').trim().length < 5) {
        throw new BadRequestException({ statusCode: 400, code: 'DECREASE_REASON_REQUIRED', message: 'A write-off or decrease needs a reason (at least 5 characters).' });
      }
      if (dto.quantity > variant.stock) {
        throw new ConflictException({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: `Only ${variant.stock} in stock; you can't remove ${dto.quantity}.` });
      }
      const decision = approvalRequired({ type: dto.type, direction, quantity: dto.quantity, stockBefore: variant.stock }, await this.getThresholds());
      if (decision.required) {
        if (!performedBy) throw new BadRequestException('A stock decrease needs a signed-in requester.');
        const request = await this.prisma.inventoryAdjustmentRequest.create({
          data: {
            tenantId, productId: product.id, variantId: variant.id, type: dto.type, direction, quantity: dto.quantity,
            stockAtRequest: variant.stock, note: dto.note?.trim() ?? null, reference: dto.reference ?? null, requestedById: performedBy,
          },
        });
        await this.auditService.log('INVENTORY_ADJUSTMENT_REQUESTED', 'Inventory', product.id, {
          requestId: request.id, type: dto.type, direction, quantity: dto.quantity, variantId: variant.id,
          stockBefore: variant.stock, stockAfterIfApproved: variant.stock - dto.quantity, policy: decision.reason,
        });
        return { status: 'PENDING_APPROVAL', reason: decision.reason, request };
      }
    }
    const result = await this.applyChange({
      productId: product.id, variantId: variant.id, type: dto.type, direction, quantity: dto.quantity,
      expectedBefore: dto.expectedStock ?? null, staleCode: 'STALE_STOCK',
      unitCost: Number(product.purchasePrice ?? 0), note: dto.note, reference: dto.reference, performedBy,
    });
    await this.auditService.log('ADJUST_STOCK', 'Inventory', product.id, {
      type: dto.type, direction, quantity: dto.quantity, variantId: variant.id,
      quantityChange: result.quantityChange,
      quantityBefore: result.quantityBefore, quantityAfter: result.quantityAfter,
      before: result.quantityBefore, after: result.quantityAfter,
      approval: direction === 'DECREASE' ? 'WITHIN_THRESHOLD' : 'NOT_REQUIRED',
      note: dto.note ?? null, reference: dto.reference ?? null, transactionId: result.id,
    });
    return result;
  }

  /** The product (this shop) and one unambiguous variant of it. */
  private async resolveTarget(productId: string, variantId?: string) {
    const tenantId = this.tenantContext.requireId;
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    // A product-level adjustment (no variantId) is only meaningful when the
    // product has exactly one variant.
    let targetVariantId = variantId;
    if (!targetVariantId) {
      const variants = await this.prisma.productVariant.findMany({ where: { productId, tenantId }, select: { id: true } });
      if (variants.length === 0) throw new BadRequestException('Product has no variants to adjust. Add a variant first.');
      if (variants.length > 1) throw new BadRequestException('This product has multiple variants — specify which variantId to adjust.');
      targetVariantId = variants[0].id;
    }
    const variant = await this.prisma.productVariant.findFirst({ where: { id: targetVariantId, tenantId } });
    if (!variant) throw new NotFoundException('Variant not found');
    // The ledger row is filed under productId: a variant of ANOTHER product
    // would add stock there while recording a change here.
    if (variant.productId !== productId) throw new BadRequestException('That variant does not belong to this product.');
    return { product, variant };
  }

  /**
   * One stock change, atomically: read the stock inside the transaction,
   * compare-and-swap it (still equal to what was read — and, for a request
   * being approved, equal to what the requester saw), and write the ledger
   * row with the real before / after.
   */
  private async applyChange(c: {
    productId: string; variantId: string; type: string; direction: 'INCREASE' | 'DECREASE'; quantity: number;
    expectedBefore: number | null; staleCode?: 'STOCK_CHANGED' | 'STALE_STOCK'; unitCost: number; note?: string | null; reference?: string | null; performedBy?: string | null;
  }) {
    const tenantId = this.tenantContext.requireId;
    const quantityChange = (c.direction === 'DECREASE' ? -1 : 1) * c.quantity;
    return this.prisma.$transaction(async (tx: any) => {
      const v = await tx.productVariant.findFirst({ where: { id: c.variantId, tenantId }, select: { stock: true } });
      if (!v) throw new NotFoundException('Variant not found');
      if (c.expectedBefore != null && v.stock !== c.expectedBefore) {
        throw new ConflictException(c.staleCode === 'STALE_STOCK'
          ? { statusCode: 409, code: 'STALE_STOCK', current: v.stock, message: `Stock changed meanwhile (now ${v.stock}). Reload and try again.` }
          : { statusCode: 409, code: 'STOCK_CHANGED', message: `Stock changed since the request (${c.expectedBefore} → ${v.stock}). Ask for a new count.`, current: v.stock });
      }
      const quantityBefore = v.stock;
      const quantityAfter = quantityBefore + quantityChange;
      if (quantityAfter < 0) {
        throw new ConflictException({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: `Only ${quantityBefore} in stock.` });
      }
      const cas = await tx.productVariant.updateMany({
        where: { id: c.variantId, tenantId, stock: quantityBefore },
        data: { stock: quantityAfter },
      });
      if (cas.count !== 1) throw new ConflictException({ statusCode: 409, code: 'STOCK_CHANGED', message: 'Stock changed while saving. Reload and try again.' });
      if (c.type === 'RESTOCK') {
        await tx.product.updateMany({ where: { id: c.productId, tenantId }, data: { lastRestockedAt: new Date() } });
      }
      return tx.inventoryTransaction.create({
        data: {
          tenantId, productId: c.productId, variantId: c.variantId, type: c.type,
          quantityBefore, quantityChange, quantityAfter,
          unitCost: c.unitCost || null,
          totalValue: c.unitCost ? c.unitCost * Math.abs(quantityChange) : null,
          note: c.note ?? null, reference: c.reference ?? null, performedBy: c.performedBy ?? null,
        },
      });
    });
  }

  // ---------------------------------------------------------------- thresholds (owner-set, no default)

  async getThresholds(): Promise<DecreaseThresholds> {
    const tenantId = this.tenantContext.requireId;
    const rows: Array<{ key: string; value: string }> = (await this.prisma.siteSetting.findMany({
      where: { tenantId, key: { in: [THRESHOLD_KEYS.maxUnits, THRESHOLD_KEYS.maxPct] } },
      select: { key: true, value: true },
    })) ?? [];
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    return { maxUnits: parseThreshold(get(THRESHOLD_KEYS.maxUnits)), maxPct: parseThreshold(get(THRESHOLD_KEYS.maxPct), 100) };
  }

  async setThresholds(dto: { maxUnits?: number | null; maxPct?: number | null }, actorId: string) {
    const tenantId = this.tenantContext.requireId;
    const before = await this.getThresholds();
    const pairs: Array<[string, number | null | undefined]> = [[THRESHOLD_KEYS.maxUnits, dto.maxUnits], [THRESHOLD_KEYS.maxPct, dto.maxPct]];
    for (const [key, val] of pairs) {
      if (val === undefined) continue;
      if (val === null) {
        await this.prisma.siteSetting.deleteMany({ where: { tenantId, key } });
      } else {
        await this.prisma.siteSetting.upsert({
          where: { tenantId_key: { tenantId, key } },
          create: { tenantId, key, value: String(val), type: 'number' },
          update: { value: String(val), type: 'number' },
        });
      }
    }
    const after = await this.getThresholds();
    await this.auditService.log('INVENTORY_APPROVAL_THRESHOLDS_CHANGED', 'Inventory', tenantId, { before, after, by: actorId });
    return after;
  }

  // ---------------------------------------------------------------- requests

  async listRequests(status?: string) {
    return this.prisma.inventoryAdjustmentRequest.findMany({
      where: { tenantId: this.tenantContext.requireId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async loadRequest(id: string) {
    const r = await this.prisma.inventoryAdjustmentRequest.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!r) throw new NotFoundException('Adjustment request not found');
    return r;
  }

  /** A DIFFERENT holder of inventory:approve applies it (no role bypasses this, SUPER_ADMIN included). */
  async approveRequest(id: string, dto: DecideAdjustmentDto, actorId: string) {
    const tenantId = this.tenantContext.requireId;
    const r = await this.loadRequest(id);
    if (r.requestedById === actorId) {
      await this.auditService.log('INVENTORY_ADJUSTMENT_DENIED', 'Inventory', r.productId, { requestId: id, reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'A write-off or stock decrease must be approved by someone other than the person who asked for it.' });
    }
    if (r.status !== 'REQUESTED') throw new ConflictException({ statusCode: 409, code: 'NOT_PENDING', message: `The request is ${r.status}.` });
    // Claim first so two approvers can't both apply it.
    const claim = await this.prisma.inventoryAdjustmentRequest.updateMany({
      where: { id, tenantId, status: 'REQUESTED' },
      data: { status: 'APPLIED', decidedById: actorId, decidedAt: new Date(), decisionNote: dto.note?.trim() || null },
    });
    if (claim.count !== 1) throw new ConflictException({ statusCode: 409, code: 'NOT_PENDING', message: 'The request was decided by someone else. Reload.' });
    const product = await this.prisma.product.findFirst({ where: { id: r.productId, tenantId }, select: { purchasePrice: true } });
    let txRow: any;
    try {
      txRow = await this.applyChange({
        productId: r.productId, variantId: r.variantId, type: r.type, direction: r.direction as 'INCREASE' | 'DECREASE', quantity: r.quantity,
        expectedBefore: r.stockAtRequest, unitCost: Number(product?.purchasePrice ?? 0),
        note: [r.note, `approved by ${actorId}`].filter(Boolean).join(' — '),
        reference: `ADJ-REQ:${r.id}`, performedBy: r.requestedById,
      });
    } catch (e: any) {
      // Not applied: STALE when the stock moved since the request, otherwise back to the queue.
      const code = e?.getResponse?.()?.code;
      const stale = code === 'STOCK_CHANGED' || code === 'INSUFFICIENT_STOCK';
      await this.prisma.inventoryAdjustmentRequest.updateMany({
        where: { id, tenantId, status: 'APPLIED', transactionId: null },
        data: stale ? { status: 'STALE' } : { status: 'REQUESTED', decidedById: null, decidedAt: null, decisionNote: null },
      });
      if (stale) {
        await this.auditService.log('INVENTORY_ADJUSTMENT_STALE', 'Inventory', r.productId, { requestId: id, stockAtRequest: r.stockAtRequest, by: actorId });
      }
      throw e;
    }
    await this.prisma.inventoryAdjustmentRequest.updateMany({ where: { id, tenantId }, data: { transactionId: txRow.id } });
    await this.auditService.log('INVENTORY_ADJUSTMENT_APPROVED', 'Inventory', r.productId, {
      requestId: id, type: r.type, direction: r.direction, quantity: r.quantity, variantId: r.variantId,
      requestedBy: r.requestedById, approvedBy: actorId,
      quantityBefore: txRow.quantityBefore, quantityAfter: txRow.quantityAfter, transactionId: txRow.id,
    });
    return { ...(await this.loadRequest(id)), transaction: txRow };
  }

  async rejectRequest(id: string, dto: DecideAdjustmentDto, actorId: string) {
    const r = await this.loadRequest(id);
    if (r.requestedById === actorId) throw new ForbiddenException({ statusCode: 403, code: 'SELF_DECISION', message: 'Withdraw your own request instead.' });
    const res = await this.prisma.inventoryAdjustmentRequest.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: 'REQUESTED' },
      data: { status: 'REJECTED', decidedById: actorId, decidedAt: new Date(), decisionNote: dto.note?.trim() || null },
    });
    if (res.count !== 1) throw new ConflictException({ statusCode: 409, code: 'NOT_PENDING', message: 'The request is no longer pending.' });
    await this.auditService.log('INVENTORY_ADJUSTMENT_REJECTED', 'Inventory', r.productId, { requestId: id, by: actorId, note: dto.note ?? null, stockAtRequest: r.stockAtRequest });
    return this.loadRequest(id);
  }

  async withdrawRequest(id: string, actorId: string) {
    const r = await this.loadRequest(id);
    if (r.requestedById !== actorId) throw new ForbiddenException({ statusCode: 403, code: 'NOT_REQUESTER', message: 'Only the person who asked can withdraw a request.' });
    const res = await this.prisma.inventoryAdjustmentRequest.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: 'REQUESTED' },
      data: { status: 'WITHDRAWN', decidedById: actorId, decidedAt: new Date() },
    });
    if (res.count !== 1) throw new ConflictException({ statusCode: 409, code: 'NOT_PENDING', message: 'The request is no longer pending.' });
    await this.auditService.log('INVENTORY_ADJUSTMENT_WITHDRAWN', 'Inventory', r.productId, { requestId: id });
    return this.loadRequest(id);
  }
}
