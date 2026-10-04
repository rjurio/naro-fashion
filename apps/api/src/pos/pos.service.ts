import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import {
  CreatePosSaleDto,
  OpenSessionDto,
  CloseSessionDto,
  HoldSaleDto,
  QueryPosSalesDto,
  PosRefundDto,
  CreateLayawayDto,
  LayawayPaymentDto,
  CreateExchangeDto,
} from './dto';
import { eatDayBounds } from '../reports/eat-time.util';

// ============================================================
// Pure money helpers (exported for unit tests)
// ============================================================

export const round2 = (n: number) => Math.round(n * 100) / 100;

type PricedItem = { unitPrice: number; quantity: number; itemDiscount?: number };

/**
 * Validates + computes POS totals. Rejects anything that could produce a
 * negative line or sale total: item discount larger than the line, % discount
 * outside 0–100, FIXED discount larger than the subtotal, unknown discount
 * types. (unitPrice >= 0 / quantity >= 1 are enforced by the DTOs; re-checked
 * here because layaway/held JSON flows through the same function.)
 */
export function computeSaleTotals(
  items: PricedItem[],
  discount?: number,
  discountType?: string,
): { subtotal: number; discountAmount: number; total: number; lineTotals: number[] } {
  const lineTotals: number[] = [];
  for (const item of items) {
    if (!(item.unitPrice >= 0)) throw new BadRequestException('Unit price cannot be negative.');
    if (!(item.quantity >= 1)) throw new BadRequestException('Quantity must be at least 1.');
    const gross = item.unitPrice * item.quantity;
    const itemDiscount = item.itemDiscount ?? 0;
    if (itemDiscount < 0 || itemDiscount > gross + 0.001) {
      throw new BadRequestException('Item discount cannot exceed the line amount.');
    }
    lineTotals.push(round2(gross - itemDiscount));
  }
  const subtotal = round2(lineTotals.reduce((s, l) => s + l, 0));

  let discountAmount = 0;
  if (discount) {
    if (discount < 0) throw new BadRequestException('Discount cannot be negative.');
    if (discountType === 'PERCENTAGE') {
      if (discount > 100) throw new BadRequestException('Percentage discount cannot exceed 100%.');
      discountAmount = round2(subtotal * (discount / 100));
    } else if (!discountType || discountType === 'FIXED') {
      if (discount > subtotal + 0.001) {
        throw new BadRequestException('Discount cannot exceed the sale subtotal.');
      }
      discountAmount = round2(discount);
    } else {
      throw new BadRequestException(`Unknown discount type ${discountType}.`);
    }
  }

  const total = round2(subtotal - discountAmount);
  if (total < 0) throw new BadRequestException('Sale total cannot be negative.');
  return { subtotal, discountAmount, total, lineTotals };
}

/**
 * Net amount the customer actually paid for `qty` units of an order line,
 * starting after `alreadyRefundedQty` units — i.e. unitPrice minus the line's
 * own item discount (baked into item.total) and minus the line's pro-rated
 * share of the order-level discount. Computed as value(prev+qty) − value(prev)
 * so successive partial refunds of a line telescope exactly to the line's net
 * value (no rounding drift past what was paid).
 */
export function refundValueForUnits(
  item: { total: any; quantity: number },
  order: { subtotal: any; discount: any },
  alreadyRefundedQty: number,
  qty: number,
): number {
  const subtotal = Number(order.subtotal);
  const discount = Number(order.discount ?? 0);
  const factor = subtotal > 0 ? Math.max(0, (subtotal - discount) / subtotal) : 0;
  const lineNet = Number(item.total) * factor;
  const value = (k: number) => round2((lineNet * k) / item.quantity);
  return round2(value(alreadyRefundedQty + qty) - value(alreadyRefundedQty));
}

/**
 * Split tendered payments into the NET amount each payment contributes.
 * Change is only ever handed back in cash, so it is deducted from CASH
 * payments; non-cash payments exceeding the total are rejected (we can't give
 * an M-Pesa overpayment back as drawer cash and still reconcile).
 */
export function allocateChange(
  payments: { method: string; amount: number }[],
  total: number,
): { net: number[]; change: number[]; changeDue: number } {
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (paid + 0.001 < total) {
    throw new BadRequestException(`Payment total (${paid}) is less than sale total (${total}).`);
  }
  let changeLeft = round2(paid - total);
  const changeDue = changeLeft;
  const cashTendered = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  if (changeLeft > cashTendered + 0.001) {
    throw new BadRequestException('Non-cash payments cannot exceed the sale total (change is only given in cash).');
  }
  const net: number[] = [];
  const change: number[] = [];
  for (const p of payments) {
    let c = 0;
    if (p.method === 'CASH' && changeLeft > 0) {
      c = Math.min(p.amount, changeLeft);
      changeLeft = round2(changeLeft - c);
    }
    change.push(round2(c));
    net.push(round2(p.amount - c));
  }
  return { net, change, changeDue };
}

@Injectable()
export class PosService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  async openSession(adminUserId: string, dto: OpenSessionDto) {
    const tenantId = this.tenantContext.requireId;

    // Check for existing open session
    const existing = await this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN', tenantId },
    });
    if (existing) {
      throw new BadRequestException(
        'You already have an open session. Close it before opening a new one.',
      );
    }

    return this.prisma.posSession.create({
      data: {
        adminUserId,
        openingCash: dto.openingCash,
        notes: dto.notes as any,
        tenantId,
      },
    });
  }

  async closeSession(adminUserId: string, dto: CloseSessionDto) {
    const tenantId = this.tenantContext.requireId;
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN', tenantId },
    });
    if (!session) {
      throw new NotFoundException('No open session found.');
    }

    const expectedCash = await this.computeExpectedCash(session);
    const cashDifference = round2(dto.closingCash - expectedCash);

    return this.prisma.posSession.update({
      where: { id: session.id },
      data: {
        closedAt: new Date(),
        closingCash: dto.closingCash,
        expectedCash,
        cashDifference,
        notes: dto.notes ?? session.notes,
        status: 'CLOSED',
      },
    });
  }

  /**
   * Drawer cash the session should hold:
   *   opening + net CASH taken (sales, layaway deposits/instalments, exchange
   *   top-ups) − CASH paid out (refunds, exchange refunds).
   *
   * Every POS-created Payment is tagged `gatewayResponse.posSessionId` with the
   * drawer it physically moved cash through (refunds/layaway instalments often
   * happen in a different session from the original sale, so the order's
   * posSessionId is the wrong key). payment.amount is the NET amount (tendered
   * minus change) — summing tendered cash overstated the drawer by every
   * change handout.
   */
  private async computeExpectedCash(session: { id: string; openingCash: any; tenantId: string | null }) {
    const tenantId = this.tenantContext.requireId;
    const tag = { path: ['posSessionId'], equals: session.id };
    const [cashIn, cashOut] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { tenantId, method: 'CASH', status: 'COMPLETED', gatewayResponse: tag },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { tenantId, method: 'CASH', status: 'REFUNDED', gatewayResponse: tag },
        _sum: { amount: true },
      }),
    ]);
    return round2(
      Number(session.openingCash) +
        Number(cashIn._sum.amount ?? 0) -
        Number(cashOut._sum.amount ?? 0),
    );
  }

  /** Throws unless the customer (User) exists in the caller's tenant. */
  private async assertCustomerInTenant(customerId?: string | null) {
    if (!customerId) return;
    const user = await this.prisma.user.findFirst({
      where: { id: customerId, tenantId: this.tenantContext.requireId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('Customer not found.');
  }

  async getCurrentSession(adminUserId: string) {
    return this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN', tenantId: this.tenantContext.requireId },
    });
  }

  async getSessions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const tenantId = this.tenantContext.requireId;
    const [data, total] = await Promise.all([
      this.prisma.posSession.findMany({
        where: { tenantId },
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.posSession.count({ where: { tenantId } }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getSessionSummary(id: string) {
    const tenantId = this.tenantContext.requireId;
    const session = await this.prisma.posSession.findUnique({ where: { id, tenantId } });
    if (!session) throw new NotFoundException('Session not found.');

    const orders = await this.prisma.order.findMany({
      where: { posSessionId: id, channel: 'POS', tenantId },
      include: { payments: true, items: true },
    });

    const paymentBreakdown: Record<string, number> = {};
    let totalSales = 0;
    let totalDiscount = 0;
    let totalItems = 0;

    for (const order of orders) {
      totalSales += Number(order.total);
      totalDiscount += Number(order.discount);
      for (const item of order.items) {
        totalItems += item.quantity;
      }
      for (const payment of order.payments) {
        if (payment.status === 'COMPLETED') {
          paymentBreakdown[payment.method] =
            (paymentBreakdown[payment.method] ?? 0) + Number(payment.amount);
        }
      }
    }

    return {
      session,
      totalSales,
      totalDiscount,
      totalItems,
      totalTransactions: orders.length,
      paymentBreakdown,
    };
  }

  // ============================================================
  // PRODUCT & CUSTOMER SEARCH
  // ============================================================

  async searchProducts(query: string) {
    if (!query || query.length < 1) return [];

    return this.prisma.product.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        isActive: true,
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          {
            variants: {
              some: {
                OR: [
                  { sku: { contains: query, mode: 'insensitive' } },
                  { barcode: { contains: query, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      },
      include: {
        variants: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            size: true,
            color: true,
            colorHex: true,
            price: true,
            stock: true,
          },
        },
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true, altText: true },
        },
        category: { select: { id: true, name: true } },
      },
      take: 20,
    });
  }

  async lookupBarcode(barcode: string) {
    // Barcodes are unique PER TENANT (@@unique([tenantId, barcode])), so the
    // same real UPC can exist in two tenants. Without the tenantId filter a
    // cashier scanning a shared barcode would get another tenant's product,
    // price, live stock, and variantId (which then feeds cross-tenant stock
    // tampering in createSale/createExchange).
    const variant = await this.prisma.productVariant.findFirst({
      where: { barcode, tenantId: this.tenantContext.requireId },
      include: {
        product: {
          include: {
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
            category: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!variant) throw new NotFoundException('No product found for this barcode.');
    return variant;
  }

  async updateBarcode(variantId: string, barcode: string) {
    // Confirm the variant is in the caller's tenant before writing — otherwise
    // a tenant-A admin who knows a tenant-B variantId could overwrite its
    // barcode and corrupt tenant B's scanning.
    const tenantId = this.tenantContext.requireId;
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { barcode },
    });
  }

  async searchCustomers(query: string) {
    if (!query || query.length < 1) return [];

    return this.prisma.user.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        isActive: true,
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
      take: 10,
    });
  }

  async quickCreateCustomer(data: { firstName: string; phone: string; lastName?: string; email?: string }) {
    const tenantId = this.tenantContext.requireId;

    // Check if phone already exists
    if (data.phone) {
      const existing = await this.prisma.user.findFirst({ where: { phone: data.phone, tenantId } });
      if (existing) {
        throw new BadRequestException('A customer with this phone number already exists.');
      }
    }

    return this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName ?? '',
        phone: data.phone,
        email: data.email,
        isVerified: false,
        tenantId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
  }

  // ============================================================
  // POS SALES
  // ============================================================

  async createSale(dto: CreatePosSaleDto, cashierId: string) {
    const tenantId = this.tenantContext.requireId;

    // 1. Validate open session
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });
    if (!session) {
      throw new BadRequestException('No open session. Please open a shift first.');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale must have at least one item.');
    }

    // 2. Validate stock and gather variant data — scoped to THIS tenant.
    // Without the tenantId filter a cashier could pass another tenant's
    // variantId and decrement that tenant's stock (and blend their product
    // into this sale). Out-of-tenant ids simply won't appear in variantMap
    // and are rejected as "not found" below.
    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, tenantId },
      include: { product: { select: { id: true, name: true } } },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));

    for (const item of dto.items) {
      const variant = variantMap.get(item.variantId);
      if (!variant) {
        throw new BadRequestException(`Variant ${item.variantId} not found.`);
      }
      if (variant.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${variant.product.name} (${variant.name}). Available: ${variant.stock}, requested: ${item.quantity}`,
        );
      }
    }

    // Customer must belong to this tenant (otherwise a cashier could attach a
    // sale — and its purchase history — to another tenant's customer).
    await this.assertCustomerInTenant(dto.customerId);

    // 3. Calculate totals (validated: no negative lines/totals, discount caps)
    const { subtotal, discountAmount, total, lineTotals } = computeSaleTotals(
      dto.items,
      dto.discount,
      dto.discountType,
    );

    // Record any cashier price override below the catalog price so it is
    // auditable on the order (unitPrice is cashier-entered).
    const overrides = dto.items
      .map((i) => {
        const v = variantMap.get(i.variantId)!;
        const catalog = Number(v.price ?? 0);
        return catalog > 0 && i.unitPrice < catalog
          ? `${v.product.name} (${v.name}): ${i.unitPrice} < catalog ${catalog}`
          : null;
      })
      .filter(Boolean);
    const orderNotes = overrides.length
      ? [dto.note, `[Price override] ${overrides.join('; ')}`].filter(Boolean).join('\n')
      : dto.note;

    // 4. Validate payments + split change out of cash (payment.amount = NET)
    const { net, change, changeDue } = allocateChange(dto.payments, total);

    // 5. Create everything in a transaction
    const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const order = await this.prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          userId: dto.customerId ?? null,
          status: 'DELIVERED',
          subtotal,
          discount: discountAmount,
          total,
          paymentMethod: dto.payments.length === 1 ? dto.payments[0].method : 'SPLIT',
          paymentStatus: 'PAID',
          notes: orderNotes,
          channel: 'POS',
          cashierId,
          posSessionId: session.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          items: {
            create: dto.items.map((item, idx) => ({
              // productId is taken from the tenant-verified variant, never
              // trusted from the client payload.
              productId: variantMap.get(item.variantId)!.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: lineTotals[idx],
            })),
          },
        },
        include: {
          items: {
            include: {
              product: { select: { name: true } },
              variant: { select: { name: true, size: true, color: true } },
            },
          },
        },
      });

      // Create payments — amount is the NET amount kept (tendered − change);
      // tendered/change are preserved in gatewayResponse for the receipt.
      for (const [idx, payment] of dto.payments.entries()) {
        await tx.payment.create({
          data: {
            tenantId,
            orderId: newOrder.id,
            amount: net[idx],
            method: payment.method,
            status: 'COMPLETED',
            transactionRef: payment.transactionRef ?? null,
            gatewayResponse: {
              posSessionId: session.id,
              cashierId,
              tendered: payment.amount,
              change: change[idx],
            },
          },
        });
      }

      // Deduct stock and log inventory transactions.
      // Atomic guarded decrement (stock >= quantity) instead of an absolute
      // write from the stale pre-transaction read — otherwise two concurrent
      // sales of the last unit both compute the same newStock and oversell.
      // A count of 0 means another writer got there first (or stock changed).
      for (const item of dto.items) {
        const variant = variantMap.get(item.variantId)!;

        const dec = await tx.productVariant.updateMany({
          where: { id: item.variantId, tenantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (dec.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for ${variant.product.name} (${variant.name}). It may have sold out during checkout.`,
          );
        }

        // Ledger values come from the post-decrement row read INSIDE the
        // transaction, not the stale pre-transaction read (which drifted
        // whenever another sale/restock landed in between).
        const after = await tx.productVariant.findFirst({
          where: { id: item.variantId, tenantId },
          select: { stock: true },
        });
        const quantityAfter = after?.stock ?? 0;
        const quantityBefore = quantityAfter + item.quantity;

        await tx.inventoryTransaction.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: item.variantId,
            type: 'SALE',
            quantityBefore,
            quantityChange: -item.quantity,
            quantityAfter,
            unitCost: item.unitPrice,
            totalValue: item.unitPrice * item.quantity,
            reference: orderNumber,
            note: `POS sale`,
            performedBy: cashierId,
          },
        });
      }

      // Update session stats
      await tx.posSession.update({
        where: { id: session.id },
        data: {
          totalSales: { increment: total },
          totalTransactions: { increment: 1 },
        },
      });

      return newOrder;
    });

    return { order, changeDue };
  }

  async getSales(query: QueryPosSalesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { channel: 'POS', tenantId: this.tenantContext.requireId };

    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.cashierId) where.cashierId = query.cashierId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.sessionId) where.posSessionId = query.sessionId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { name: true } },
              variant: { select: { name: true, size: true, color: true } },
            },
          },
          payments: true,
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getSale(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id, tenantId: this.tenantContext.requireId },
      include: {
        items: {
          include: {
            product: { select: { name: true, sku: true } },
            variant: { select: { name: true, size: true, color: true, sku: true } },
          },
        },
        payments: true,
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException('Sale not found.');
    return order;
  }

  async getReceipt(id: string) {
    const order = await this.getSale(id);
    // payment.amount is NET (tendered − change) since the cash-reconciliation
    // fix; tendered/change live in gatewayResponse. Legacy rows (no tag) stored
    // the tendered amount, so fall back to the old sum − total formula.
    const completed = order.payments.filter((p) => p.status === 'COMPLETED');
    const meta = (p: any) => (p.gatewayResponse ?? {}) as { tendered?: number; change?: number };
    const tagged = completed.some((p) => meta(p).tendered !== undefined);
    const changeDue = tagged
      ? completed.reduce((sum, p) => sum + Number(meta(p).change ?? 0), 0)
      : completed.reduce((sum, p) => sum + Number(p.amount), 0) - Number(order.total);

    return {
      storeName: 'NARO FASHION',
      orderNumber: order.orderNumber,
      date: order.createdAt,
      cashier: order.cashierId,
      customer: order.userId
        ? `${order.user?.firstName ?? ''} ${order.user?.lastName ?? ''}`.trim()
        : order.customerName ?? 'Walk-in Customer',
      customerPhone: order.user?.phone ?? order.customerPhone,
      items: order.items.map((item) => ({
        name: item.product.name,
        variant: item.variant.name,
        size: item.variant.size,
        color: item.variant.color,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.total),
      })),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      total: Number(order.total),
      payments: completed.map((p) => ({
        method: p.method,
        amount: Number(meta(p).tendered ?? p.amount),
        transactionRef: p.transactionRef,
      })),
      changeDue: changeDue > 0 ? changeDue : 0,
    };
  }

  // ============================================================
  // HOLD / PARK SALES
  // ============================================================

  async holdSale(adminUserId: string, dto: HoldSaleDto) {
    await this.assertCustomerInTenant(dto.customerId);
    computeSaleTotals(dto.items, dto.discount, dto.discountType); // validate only
    return this.prisma.heldSale.create({
      data: {
        tenantId: this.tenantContext.requireId,
        adminUserId,
        customerId: dto.customerId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        items: dto.items as any,
        discount: dto.discount ?? 0,
        discountType: dto.discountType,
        note: dto.note,
      },
    });
  }

  async getHeldSales(adminUserId: string) {
    return this.prisma.heldSale.findMany({
      where: { adminUserId, tenantId: this.tenantContext.requireId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resumeHeldSale(id: string, adminUserId: string) {
    const held = await this.prisma.heldSale.findFirst({
      where: { id, adminUserId, tenantId: this.tenantContext.requireId },
    });
    if (!held) throw new NotFoundException('Held sale not found.');

    await this.prisma.heldSale.delete({ where: { id } });
    return held;
  }

  async discardHeldSale(id: string, adminUserId: string) {
    const held = await this.prisma.heldSale.findFirst({
      where: { id, adminUserId, tenantId: this.tenantContext.requireId },
    });
    if (!held) throw new NotFoundException('Held sale not found.');
    return this.prisma.heldSale.delete({ where: { id } });
  }

  // ============================================================
  // REFUNDS
  // ============================================================

  async refundSale(orderId: string, dto: PosRefundDto, cashierId: string) {
    const tenantId = this.tenantContext.requireId;
    const isFullRefund = !dto.items || dto.items.length === 0;

    // Drawer the refund cash leaves from (tagged on the payment so
    // closeSession subtracts it). A CASH refund without an open shift would
    // be untraceable in reconciliation, so require one.
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });
    if (dto.refundMethod === 'CASH' && !session) {
      throw new BadRequestException('Open a shift before issuing a cash refund.');
    }

    // EVERYTHING — the order read, the remaining-quantity math and the
    // already-refunded cap — happens inside the transaction. Each line's
    // refundedQuantity is claimed with an atomic guarded increment
    // (`updateMany where refundedQuantity <= quantity − n`), so two concurrent
    // refunds of the same line can't both pass: the loser's updateMany
    // matches 0 rows and the whole transaction rolls back (restocks included).
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: { items: true, payments: true },
      });
      if (!order) throw new NotFoundException('Sale not found.');
      if (order.channel !== 'POS') {
        throw new BadRequestException('Only POS sales can be refunded from POS.');
      }
      if (order.status === 'REFUNDED' || order.paymentStatus === 'REFUNDED') {
        throw new BadRequestException('This sale has already been refunded.');
      }
      if (order.status === 'CANCELLED') {
        throw new BadRequestException('Cancelled sales cannot be refunded.');
      }

      // Cumulative cash cap: total of prior REFUNDED payments (refunds AND
      // exchange cash-backs), read inside the tx.
      const alreadyRefundedAmount = order.payments
        .filter((p) => p.status === 'REFUNDED')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      // Resolve what to refund: [{ item, qty }]
      const lines: { item: (typeof order.items)[number]; qty: number }[] = [];
      if (isFullRefund) {
        for (const item of order.items) {
          const remaining = item.quantity - item.refundedQuantity;
          if (remaining > 0) lines.push({ item, qty: remaining });
        }
      } else {
        for (const refundItem of dto.items!) {
          const item = order.items.find((i) => i.id === refundItem.orderItemId);
          if (!item) {
            throw new BadRequestException(`Order item ${refundItem.orderItemId} not found.`);
          }
          const remaining = item.quantity - item.refundedQuantity;
          if (refundItem.quantity > remaining) {
            throw new BadRequestException(
              `Cannot refund more than the remaining ${remaining} unit(s) for this item (already refunded ${item.refundedQuantity} of ${item.quantity}).`,
            );
          }
          lines.push({ item, qty: refundItem.quantity });
        }
      }

      let refundAmount = 0;
      for (const { item, qty } of lines) {
        // Atomic claim of the units. `quantity` is immutable, so the literal
        // bound is safe; refundedQuantity is compared against the DB row.
        const claim = await tx.orderItem.updateMany({
          where: { id: item.id, orderId: order.id, refundedQuantity: { lte: item.quantity - qty } },
          data: { refundedQuantity: { increment: qty } },
        });
        if (claim.count === 0) {
          throw new BadRequestException(
            'This item was refunded or exchanged concurrently. Reload the sale and try again.',
          );
        }

        // Net price actually paid (item discount + pro-rated order discount).
        refundAmount += refundValueForUnits(item, order, item.refundedQuantity, qty);

        await this.restockVariant(
          tx,
          tenantId,
          item.variantId,
          item.productId,
          qty,
          order.orderNumber,
          `POS ${isFullRefund ? 'refund' : 'partial refund'}: ${dto.reason ?? (isFullRefund ? 'Full refund' : 'Partial refund')}`,
          cashierId,
        );
      }
      refundAmount = round2(refundAmount);

      if (refundAmount <= 0) {
        throw new BadRequestException('Nothing left to refund on this sale.');
      }

      // Cumulative cash cap (defence-in-depth; the transaction rolls back the
      // restocks above if this trips). Sub-shilling rounding residue on the
      // final refund is clamped to exactly what's left.
      const remainingPaid = round2(Number(order.total) - alreadyRefundedAmount);
      if (refundAmount > remainingPaid + 0.01) {
        throw new BadRequestException('Refund would exceed the amount paid for this sale.');
      }
      refundAmount = Math.min(refundAmount, Math.max(0, remainingPaid));

      await tx.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          amount: refundAmount,
          method: dto.refundMethod,
          status: 'REFUNDED',
          gatewayResponse: {
            posSessionId: session?.id ?? null,
            cashierId,
            reason: dto.reason ?? null,
          },
        },
      });

      // Fully refunded once every line's cumulative refunded qty (re-read
      // after our increments) reaches its purchased quantity.
      const after = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { quantity: true, refundedQuantity: true },
      });
      const fullyRefunded = after.every((i) => i.refundedQuantity >= i.quantity);

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: fullyRefunded ? 'REFUNDED' : order.status,
          paymentStatus: fullyRefunded ? 'REFUNDED' : 'PARTIAL',
        },
      });

      return { refundAmount, isFullRefund: fullyRefunded };
    });
  }

  /** Atomic tenant-scoped restock + ledger row (post-increment read in tx). */
  private async restockVariant(
    tx: any,
    tenantId: string,
    variantId: string,
    productId: string,
    qty: number,
    reference: string,
    note: string,
    performedBy: string,
  ) {
    await tx.productVariant.updateMany({
      where: { id: variantId, tenantId },
      data: { stock: { increment: qty } },
    });
    const after = await tx.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: { stock: true },
    });
    const quantityAfter = after?.stock ?? 0;
    await tx.inventoryTransaction.create({
      data: {
        tenantId,
        productId,
        variantId,
        type: 'ADJUSTMENT',
        quantityBefore: quantityAfter - qty,
        quantityChange: qty,
        quantityAfter,
        reference,
        note,
        performedBy,
      },
    });
  }

  // ============================================================
  // LAYAWAY
  // ============================================================

  async createLayaway(dto: CreateLayawayDto, cashierId: string) {
    const tenantId = this.tenantContext.requireId;
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Layaway must have at least one item.');
    }
    if (dto.depositMethod === 'CASH' && dto.depositAmount > 0 && !session) {
      throw new BadRequestException('Open a shift before taking a cash deposit.');
    }

    // Customer + variants must belong to this tenant.
    await this.assertCustomerInTenant(dto.customerId);
    const variantIds = [...new Set(dto.items.map((i) => i.variantId))];
    const found = await this.prisma.productVariant.count({
      where: { id: { in: variantIds }, tenantId },
    });
    if (found !== variantIds.length) {
      throw new BadRequestException('One or more layaway items were not found.');
    }

    // Calculate totals (validated: no negative lines/totals, discount caps)
    const { subtotal, discountAmount, total } = computeSaleTotals(
      dto.items,
      dto.discount,
      dto.discountType,
    );

    if (dto.depositAmount > total) {
      throw new BadRequestException('Deposit cannot exceed total amount.');
    }

    const layawayNumber = `LAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      const layaway = await tx.layaway.create({
        data: {
          tenantId,
          layawayNumber,
          customerId: dto.customerId,
          cashierId,
          posSessionId: session?.id,
          items: dto.items as any,
          subtotal,
          discount: discountAmount,
          discountType: dto.discountType,
          total,
          depositAmount: dto.depositAmount,
          depositPaid: dto.depositAmount,
          balanceDue: total - dto.depositAmount,
          dueDate: new Date(dto.dueDate),
          note: dto.note,
        },
      });

      // Record deposit payment
      if (dto.depositAmount > 0) {
        await tx.payment.create({
          data: {
            tenantId,
            layawayId: layaway.id,
            amount: dto.depositAmount,
            method: dto.depositMethod,
            status: 'COMPLETED',
            transactionRef: dto.depositTransactionRef,
            gatewayResponse: { posSessionId: session?.id ?? null, cashierId },
          },
        });
      }

      return layaway;
    });
  }

  async getLayaways(status?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = { tenantId: this.tenantContext.requireId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.layaway.findMany({
        where,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.layaway.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getLayaway(id: string) {
    const layaway = await this.prisma.layaway.findUnique({
      where: { id, tenantId: this.tenantContext.requireId },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!layaway) throw new NotFoundException('Layaway not found.');
    return layaway;
  }

  async layawayPayment(id: string, dto: LayawayPaymentDto, cashierId: string) {
    const tenantId = this.tenantContext.requireId;
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });
    if (dto.method === 'CASH' && !session) {
      throw new BadRequestException('Open a shift before taking a cash payment.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Atomic claim: only an ACTIVE layaway with enough balance left can take
      // this payment. Previously the status/balance check ran outside the tx
      // and the new balance was written as an absolute value from that stale
      // read — two concurrent instalments could both pass and one was lost
      // (or the balance went negative).
      const claim = await tx.layaway.updateMany({
        where: { id, tenantId, status: 'ACTIVE', balanceDue: { gte: dto.amount } },
        data: {
          depositPaid: { increment: dto.amount },
          balanceDue: { decrement: dto.amount },
        },
      });
      if (claim.count === 0) {
        const layaway = await tx.layaway.findFirst({ where: { id, tenantId } });
        if (!layaway) throw new NotFoundException('Layaway not found.');
        if (layaway.status !== 'ACTIVE') {
          throw new BadRequestException('This layaway is no longer active.');
        }
        throw new BadRequestException('Payment exceeds balance due.');
      }

      await tx.payment.create({
        data: {
          tenantId,
          layawayId: id,
          amount: dto.amount,
          method: dto.method,
          status: 'COMPLETED',
          transactionRef: dto.transactionRef,
          gatewayResponse: { posSessionId: session?.id ?? null, cashierId },
        },
      });

      return tx.layaway.findFirst({
        where: { id, tenantId },
        include: { payments: true },
      });
    });
  }

  async completeLayaway(id: string, cashierId: string) {
    const tenantId = this.tenantContext.requireId;
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });

    const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      // Idempotency claim FIRST: the conditional ACTIVE → COMPLETED transition
      // succeeds for exactly one caller. A double-click / retry used to pass
      // the outside-tx status check twice and create two orders + deduct
      // stock twice for one layaway.
      const claim = await tx.layaway.updateMany({
        where: { id, tenantId, status: 'ACTIVE', balanceDue: { lte: 0 } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (claim.count === 0) {
        const existing = await tx.layaway.findFirst({ where: { id, tenantId } });
        if (!existing) throw new NotFoundException('Layaway not found.');
        if (existing.status !== 'ACTIVE') {
          throw new BadRequestException('This layaway is no longer active.');
        }
        throw new BadRequestException(
          `Outstanding balance of ${existing.balanceDue}. Full payment required before completion.`,
        );
      }

      const layaway = (await tx.layaway.findFirst({ where: { id, tenantId } }))!;
      const items = layaway.items as any[];

      // Resolve variants inside the tenant (item JSON is client-originated);
      // productId comes from the verified variant, never the JSON.
      const variants = await tx.productVariant.findMany({
        where: { id: { in: items.map((i: any) => i.variantId) }, tenantId },
        select: { id: true, productId: true },
      });
      const productOf = new Map(variants.map((v: any) => [v.id, v.productId]));
      for (const item of items) {
        if (!productOf.has(item.variantId)) {
          throw new BadRequestException(
            `Item ${item.productName ?? item.variantId} is no longer available.`,
          );
        }
      }

      const order = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          userId: layaway.customerId,
          status: 'DELIVERED',
          subtotal: layaway.subtotal,
          discount: layaway.discount,
          total: layaway.total,
          paymentMethod: 'LAYAWAY',
          paymentStatus: 'PAID',
          notes: `Converted from layaway ${layaway.layawayNumber}`,
          channel: 'POS',
          cashierId,
          posSessionId: session?.id,
          items: {
            create: items.map((item: any) => ({
              productId: productOf.get(item.variantId)!,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: round2(item.unitPrice * item.quantity - (item.itemDiscount ?? 0)),
            })),
          },
        },
      });

      // Deduct stock — tenant-scoped atomic guarded decrement (see createSale).
      for (const item of items) {
        const dec = await tx.productVariant.updateMany({
          where: { id: item.variantId, tenantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (dec.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for ${item.productName} (${item.variantName}). It may have sold out.`,
          );
        }
        const after = await tx.productVariant.findFirst({
          where: { id: item.variantId, tenantId },
          select: { stock: true },
        });
        const quantityAfter = after?.stock ?? 0;
        await tx.inventoryTransaction.create({
          data: {
            tenantId,
            productId: productOf.get(item.variantId)!,
            variantId: item.variantId,
            type: 'SALE',
            quantityBefore: quantityAfter + item.quantity,
            quantityChange: -item.quantity,
            quantityAfter,
            reference: orderNumber,
            note: `Layaway completion: ${layaway.layawayNumber}`,
            performedBy: cashierId,
          },
        });
      }

      // Update session stats
      if (session) {
        await tx.posSession.update({
          where: { id: session.id },
          data: {
            totalSales: { increment: Number(layaway.total) },
            totalTransactions: { increment: 1 },
          },
        });
      }

      return order;
    });
  }

  async cancelLayaway(id: string) {
    const tenantId = this.tenantContext.requireId;
    // Conditional transition — can't race a concurrent completeLayaway.
    const claim = await this.prisma.layaway.updateMany({
      where: { id, tenantId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (claim.count === 0) {
      const layaway = await this.prisma.layaway.findFirst({ where: { id, tenantId } });
      if (!layaway) throw new NotFoundException('Layaway not found.');
      throw new BadRequestException('This layaway is no longer active.');
    }
    return this.prisma.layaway.findFirst({ where: { id, tenantId } });
  }

  // ============================================================
  // EXCHANGE
  // ============================================================

  async createExchange(dto: CreateExchangeDto, cashierId: string) {
    const tenantId = this.tenantContext.requireId;
    if (!dto.returnedItems || dto.returnedItems.length === 0) {
      throw new BadRequestException('An exchange must return at least one item.');
    }

    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN', tenantId },
    });

    // New items: tenant-scoped variant lookup (dto.newItems is
    // attacker-controlled; an out-of-tenant variantId must not resolve).
    // Authoritative stock guard is the atomic decrement in the tx.
    const newVariantIds = [...new Set(dto.newItems.map((ni) => ni.variantId))];
    const newVariants = newVariantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: newVariantIds }, tenantId },
          include: { product: { select: { name: true } } },
        })
      : [];
    const newVariantMap = new Map(newVariants.map((v) => [v.id, v]));
    for (const ni of dto.newItems) {
      const variant = newVariantMap.get(ni.variantId);
      if (!variant) throw new BadRequestException(`Variant ${ni.variantId} not found.`);
      if (variant.stock < ni.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${variant.product.name} (${variant.name}).`,
        );
      }
    }
    const { total: newTotal, lineTotals: newLineTotals } = dto.newItems.length
      ? computeSaleTotals(dto.newItems)
      : { total: 0, lineTotals: [] as number[] };

    const exchangeNumber = `EXC-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      // Original order read INSIDE the tx.
      const originalOrder = await tx.order.findFirst({
        where: { id: dto.originalOrderId, tenantId },
        include: { items: { include: { variant: true, product: true } } },
      });
      if (!originalOrder) throw new NotFoundException('Original order not found.');
      if (originalOrder.channel !== 'POS') {
        throw new BadRequestException('Only POS sales can be exchanged at the POS.');
      }
      if (
        ['REFUNDED', 'CANCELLED'].includes(originalOrder.status) ||
        !['PAID', 'PARTIAL'].includes(originalOrder.paymentStatus)
      ) {
        throw new BadRequestException(
          'This sale is refunded, cancelled or unpaid and cannot be exchanged.',
        );
      }

      // Returned lines: bounded by REMAINING units (quantity − refundedQuantity)
      // and claimed with an atomic guarded increment of refundedQuantity, the
      // same counter refundSale uses — so a line can't be exchanged twice, or
      // exchanged and then refunded again, even concurrently.
      let returnTotal = 0;
      const returnItemDetails: any[] = [];
      for (const ri of dto.returnedItems) {
        const orderItem = originalOrder.items.find((i) => i.id === ri.orderItemId);
        if (!orderItem) {
          throw new BadRequestException(`Order item ${ri.orderItemId} not found.`);
        }
        const remaining = orderItem.quantity - orderItem.refundedQuantity;
        if (ri.quantity > remaining) {
          throw new BadRequestException(
            `Cannot return more than the remaining ${remaining} unit(s) for item ${ri.orderItemId}.`,
          );
        }
        const claim = await tx.orderItem.updateMany({
          where: {
            id: orderItem.id,
            orderId: originalOrder.id,
            refundedQuantity: { lte: orderItem.quantity - ri.quantity },
          },
          data: { refundedQuantity: { increment: ri.quantity } },
        });
        if (claim.count === 0) {
          throw new BadRequestException(
            'This item was refunded or exchanged concurrently. Reload the sale and try again.',
          );
        }

        // Credit = net price actually paid (discounts honoured).
        const credit = refundValueForUnits(
          orderItem,
          originalOrder,
          orderItem.refundedQuantity,
          ri.quantity,
        );
        returnTotal += credit;
        returnItemDetails.push({
          orderItemId: ri.orderItemId,
          productId: orderItem.productId,
          variantId: orderItem.variantId,
          productName: orderItem.product.name,
          variantName: orderItem.variant.name,
          quantity: ri.quantity,
          unitPrice: Number(orderItem.unitPrice),
          credit,
        });
      }
      returnTotal = round2(returnTotal);

      const priceDifference = round2(newTotal - returnTotal); // + = customer owes
      if (priceDifference !== 0 && !dto.settlementMethod) {
        throw new BadRequestException('A settlement method is required when the exchange has a price difference.');
      }
      if (dto.settlementMethod === 'CASH' && priceDifference !== 0 && !session) {
        throw new BadRequestException('Open a shift before settling an exchange in cash.');
      }

      // Restock returned items (atomic, tenant-scoped, ledgered).
      for (const ri of returnItemDetails) {
        await this.restockVariant(
          tx, tenantId, ri.variantId, ri.productId, ri.quantity,
          exchangeNumber, 'Exchange return', cashierId,
        );
      }

      // New items: order + guarded stock decrement
      let newOrderId: string | null = null;
      if (dto.newItems.length > 0) {
        const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const newOrder = await tx.order.create({
          data: {
            tenantId,
            orderNumber,
            userId: originalOrder.userId,
            status: 'DELIVERED',
            subtotal: newTotal,
            // Credit from the returned goods is applied as a discount, so
            // subtotal − discount = what the customer actually paid now.
            discount: priceDifference > 0 ? returnTotal : newTotal,
            total: priceDifference > 0 ? priceDifference : 0,
            paymentMethod: dto.settlementMethod ?? 'EXCHANGE',
            paymentStatus: 'PAID',
            notes: `Exchange from ${originalOrder.orderNumber}`,
            channel: 'POS',
            cashierId,
            posSessionId: session?.id,
            customerName: originalOrder.customerName,
            customerPhone: originalOrder.customerPhone,
            items: {
              create: dto.newItems.map((ni, idx) => ({
                productId: newVariantMap.get(ni.variantId)!.productId,
                variantId: ni.variantId,
                quantity: ni.quantity,
                unitPrice: ni.unitPrice,
                total: newLineTotals[idx],
              })),
            },
          },
        });
        newOrderId = newOrder.id;

        for (const ni of dto.newItems) {
          const productId = newVariantMap.get(ni.variantId)!.productId;
          const dec = await tx.productVariant.updateMany({
            where: { id: ni.variantId, tenantId, stock: { gte: ni.quantity } },
            data: { stock: { decrement: ni.quantity } },
          });
          if (dec.count === 0) {
            throw new BadRequestException(
              `Insufficient stock for the exchange item. It may have sold out.`,
            );
          }
          const after = await tx.productVariant.findFirst({
            where: { id: ni.variantId, tenantId },
            select: { stock: true },
          });
          const quantityAfter = after?.stock ?? 0;
          await tx.inventoryTransaction.create({
            data: {
              tenantId,
              productId,
              variantId: ni.variantId,
              type: 'SALE',
              quantityBefore: quantityAfter + ni.quantity,
              quantityChange: -ni.quantity,
              quantityAfter,
              reference: exchangeNumber,
              note: `Exchange new item`,
              performedBy: cashierId,
            },
          });
        }
      }

      // Settlement money movement — recorded as Payment rows (tagged with the
      // drawer) so closeSession reconciles exchange cash in/out:
      //   customer owes  → COMPLETED payment on the new order
      //   customer is owed → REFUNDED payment on the ORIGINAL order (also counts
      //   toward that order's cumulative refund cap in refundSale).
      const tag = { posSessionId: session?.id ?? null, cashierId, exchangeNumber };
      if (priceDifference > 0) {
        await tx.payment.create({
          data: {
            tenantId,
            orderId: newOrderId,
            amount: priceDifference,
            method: dto.settlementMethod!,
            status: 'COMPLETED',
            gatewayResponse: tag,
          },
        });
      } else if (priceDifference < 0) {
        await tx.payment.create({
          data: {
            tenantId,
            orderId: originalOrder.id,
            amount: Math.abs(priceDifference),
            method: dto.settlementMethod!,
            status: 'REFUNDED',
            gatewayResponse: tag,
          },
        });
      }

      // Original order bookkeeping: fully returned → REFUNDED, else PARTIAL.
      const after = await tx.orderItem.findMany({
        where: { orderId: originalOrder.id },
        select: { quantity: true, refundedQuantity: true },
      });
      const fullyReturned = after.every((i) => i.refundedQuantity >= i.quantity);
      await tx.order.update({
        where: { id: originalOrder.id },
        data: {
          status: fullyReturned ? 'REFUNDED' : originalOrder.status,
          paymentStatus: fullyReturned ? 'REFUNDED' : 'PARTIAL',
        },
      });

      // Create exchange record
      const exchange = await tx.posExchange.create({
        data: {
          tenantId,
          exchangeNumber,
          originalOrderId: originalOrder.id,
          newOrderId,
          cashierId,
          posSessionId: session?.id,
          customerId: originalOrder.userId,
          returnedItems: returnItemDetails,
          returnTotal,
          newItems: dto.newItems as any,
          newTotal,
          priceDifference,
          settlementMethod: dto.settlementMethod,
          settlementAmount: Math.abs(priceDifference),
          reason: dto.reason,
          note: dto.note,
        },
      });

      return exchange;
    });
  }

  async getExchanges(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const tenantId = this.tenantContext.requireId;
    const [data, total] = await Promise.all([
      this.prisma.posExchange.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.posExchange.count({ where: { tenantId } }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getExchange(id: string) {
    const exchange = await this.prisma.posExchange.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!exchange) throw new NotFoundException('Exchange not found.');
    return exchange;
  }

  // ============================================================
  // DAILY SUMMARY
  // ============================================================

  async getDailySummary(date?: string) {
    // Business day = Africa/Dar_es_Salaam (UTC+3). The server runs in UTC, so
    // setHours(0,0,0,0) put the boundary at 03:00 EAT.
    let bounds: ReturnType<typeof eatDayBounds>;
    try {
      bounds = eatDayBounds(date);
    } catch {
      throw new BadRequestException('Invalid date. Use YYYY-MM-DD.');
    }
    const { start: startOfDay, end: endOfDay, dateKey } = bounds;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        channel: 'POS',
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      include: { payments: true, items: true },
    });

    const paymentBreakdown: Record<string, number> = {};
    let totalSales = 0;
    let totalDiscount = 0;
    let totalItems = 0;
    let totalRefunds = 0;

    for (const order of orders) {
      totalSales += Number(order.total);
      totalDiscount += Number(order.discount);
      for (const item of order.items) {
        totalItems += item.quantity;
      }
      for (const payment of order.payments) {
        if (payment.status === 'COMPLETED') {
          paymentBreakdown[payment.method] =
            (paymentBreakdown[payment.method] ?? 0) + Number(payment.amount);
        }
      }
    }

    // Refunds are booked on the day the money went back (any POS sale, even
    // one from an earlier day), not on the original sale's day.
    const refunds = await this.prisma.payment.aggregate({
      where: {
        tenantId: this.tenantContext.requireId,
        status: 'REFUNDED',
        order: { channel: 'POS' },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      _sum: { amount: true },
    });
    totalRefunds = Number(refunds._sum.amount ?? 0);

    return {
      date: dateKey,
      totalSales,
      totalDiscount,
      totalRefunds,
      netSales: totalSales - totalRefunds,
      totalTransactions: orders.length,
      totalItems,
      paymentBreakdown,
    };
  }
}
