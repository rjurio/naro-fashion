import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class PosService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  // SESSION MANAGEMENT
  // ============================================================

  async openSession(adminUserId: string, dto: OpenSessionDto) {
    // Check for existing open session
    const existing = await this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN' },
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
      },
    });
  }

  async closeSession(adminUserId: string, dto: CloseSessionDto) {
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN' },
    });
    if (!session) {
      throw new NotFoundException('No open session found.');
    }

    // Calculate expected cash: opening + cash sales during session
    const cashPayments = await this.prisma.payment.aggregate({
      where: {
        order: { posSessionId: session.id },
        method: { in: ['CASH'] },
        status: 'COMPLETED',
      },
      _sum: { amount: true },
    });

    const expectedCash =
      Number(session.openingCash) + Number(cashPayments._sum.amount ?? 0);
    const cashDifference = dto.closingCash - expectedCash;

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

  async getCurrentSession(adminUserId: string) {
    return this.prisma.posSession.findFirst({
      where: { adminUserId, status: 'OPEN' },
    });
  }

  async getSessions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.posSession.findMany({
        orderBy: { openedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.posSession.count(),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getSessionSummary(id: string) {
    const session = await this.prisma.posSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found.');

    const orders = await this.prisma.order.findMany({
      where: { posSessionId: id, channel: 'POS' },
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
    const variant = await this.prisma.productVariant.findUnique({
      where: { barcode },
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
    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { barcode },
    });
  }

  async searchCustomers(query: string) {
    if (!query || query.length < 1) return [];

    return this.prisma.user.findMany({
      where: {
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
    // Check if phone already exists
    if (data.phone) {
      const existing = await this.prisma.user.findUnique({ where: { phone: data.phone } });
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
    // 1. Validate open session
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN' },
    });
    if (!session) {
      throw new BadRequestException('No open session. Please open a shift first.');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sale must have at least one item.');
    }

    // 2. Validate stock and gather variant data
    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
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

    // 3. Calculate totals
    let subtotal = 0;
    for (const item of dto.items) {
      const lineTotal = item.unitPrice * item.quantity - (item.itemDiscount ?? 0);
      subtotal += lineTotal;
    }

    let discountAmount = 0;
    if (dto.discount) {
      if (dto.discountType === 'PERCENTAGE') {
        discountAmount = subtotal * (dto.discount / 100);
      } else {
        discountAmount = dto.discount;
      }
    }

    const total = subtotal - discountAmount;

    // 4. Validate payments
    const paymentTotal = dto.payments.reduce((sum, p) => sum + p.amount, 0);
    if (paymentTotal < total) {
      throw new BadRequestException(
        `Payment total (${paymentTotal}) is less than sale total (${total}).`,
      );
    }

    const changeDue = paymentTotal - total;

    // 5. Create everything in a transaction
    const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const order = await this.prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId: dto.customerId ?? null,
          status: 'DELIVERED',
          subtotal,
          discount: discountAmount,
          total,
          paymentMethod: dto.payments.length === 1 ? dto.payments[0].method : 'SPLIT',
          paymentStatus: 'PAID',
          notes: dto.note,
          channel: 'POS',
          cashierId,
          posSessionId: session.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.unitPrice * item.quantity - (item.itemDiscount ?? 0),
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

      // Create payments
      for (const payment of dto.payments) {
        await tx.payment.create({
          data: {
            orderId: newOrder.id,
            amount: payment.amount,
            method: payment.method,
            status: 'COMPLETED',
            transactionRef: payment.transactionRef ?? null,
          },
        });
      }

      // Deduct stock and log inventory transactions
      for (const item of dto.items) {
        const variant = variantMap.get(item.variantId)!;
        const newStock = variant.stock - item.quantity;

        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: newStock },
        });

        await tx.inventoryTransaction.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            type: 'SALE',
            quantityBefore: variant.stock,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
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

    const where: any = { channel: 'POS' };

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
      where: { id },
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
    const changeDue =
      order.payments.reduce((sum, p) => sum + Number(p.amount), 0) - Number(order.total);

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
      payments: order.payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        transactionRef: p.transactionRef,
      })),
      changeDue: changeDue > 0 ? changeDue : 0,
    };
  }

  // ============================================================
  // HOLD / PARK SALES
  // ============================================================

  async holdSale(adminUserId: string, dto: HoldSaleDto) {
    return this.prisma.heldSale.create({
      data: {
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
      where: { adminUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resumeHeldSale(id: string, adminUserId: string) {
    const held = await this.prisma.heldSale.findFirst({
      where: { id, adminUserId },
    });
    if (!held) throw new NotFoundException('Held sale not found.');

    await this.prisma.heldSale.delete({ where: { id } });
    return held;
  }

  async discardHeldSale(id: string, adminUserId: string) {
    const held = await this.prisma.heldSale.findFirst({
      where: { id, adminUserId },
    });
    if (!held) throw new NotFoundException('Held sale not found.');
    return this.prisma.heldSale.delete({ where: { id } });
  }

  // ============================================================
  // REFUNDS
  // ============================================================

  async refundSale(orderId: string, dto: PosRefundDto, cashierId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { variant: true } }, payments: true },
    });
    if (!order) throw new NotFoundException('Sale not found.');
    if (order.channel !== 'POS') {
      throw new BadRequestException('Only POS sales can be refunded from POS.');
    }
    if (order.status === 'REFUNDED') {
      throw new BadRequestException('This sale has already been refunded.');
    }

    const isFullRefund = !dto.items || dto.items.length === 0;

    return this.prisma.$transaction(async (tx) => {
      let refundAmount = 0;

      if (isFullRefund) {
        // Full refund: restore all stock
        refundAmount = Number(order.total);
        for (const item of order.items) {
          const variant = item.variant;
          const newStock = variant.stock + item.quantity;
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: newStock },
          });
          await tx.inventoryTransaction.create({
            data: {
              productId: item.productId,
              variantId: item.variantId,
              type: 'ADJUSTMENT',
              quantityBefore: variant.stock,
              quantityChange: item.quantity,
              quantityAfter: newStock,
              reference: order.orderNumber,
              note: `POS refund: ${dto.reason ?? 'Full refund'}`,
              performedBy: cashierId,
            },
          });
        }
      } else {
        // Partial refund
        for (const refundItem of dto.items!) {
          const orderItem = order.items.find((i) => i.id === refundItem.orderItemId);
          if (!orderItem) {
            throw new BadRequestException(`Order item ${refundItem.orderItemId} not found.`);
          }
          if (refundItem.quantity > orderItem.quantity) {
            throw new BadRequestException(
              `Cannot refund more than purchased quantity for item ${refundItem.orderItemId}.`,
            );
          }

          refundAmount += Number(orderItem.unitPrice) * refundItem.quantity;

          const variant = orderItem.variant;
          const newStock = variant.stock + refundItem.quantity;
          await tx.productVariant.update({
            where: { id: orderItem.variantId },
            data: { stock: newStock },
          });
          await tx.inventoryTransaction.create({
            data: {
              productId: orderItem.productId,
              variantId: orderItem.variantId,
              type: 'ADJUSTMENT',
              quantityBefore: variant.stock,
              quantityChange: refundItem.quantity,
              quantityAfter: newStock,
              reference: order.orderNumber,
              note: `POS partial refund: ${dto.reason ?? 'Partial refund'}`,
              performedBy: cashierId,
            },
          });
        }
      }

      // Create refund payment record
      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: refundAmount,
          method: dto.refundMethod,
          status: 'REFUNDED',
        },
      });

      // Update order status
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: isFullRefund ? 'REFUNDED' : order.status,
          paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIAL',
        },
      });

      return { refundAmount, isFullRefund };
    });
  }

  // ============================================================
  // LAYAWAY
  // ============================================================

  async createLayaway(dto: CreateLayawayDto, cashierId: string) {
    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN' },
    });

    // Calculate totals
    let subtotal = 0;
    for (const item of dto.items) {
      subtotal += item.unitPrice * item.quantity - (item.itemDiscount ?? 0);
    }

    let discountAmount = 0;
    if (dto.discount) {
      discountAmount =
        dto.discountType === 'PERCENTAGE'
          ? subtotal * (dto.discount / 100)
          : dto.discount;
    }

    const total = subtotal - discountAmount;

    if (dto.depositAmount > total) {
      throw new BadRequestException('Deposit cannot exceed total amount.');
    }

    const layawayNumber = `LAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      const layaway = await tx.layaway.create({
        data: {
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
            layawayId: layaway.id,
            amount: dto.depositAmount,
            method: dto.depositMethod,
            status: 'COMPLETED',
            transactionRef: dto.depositTransactionRef,
          },
        });
      }

      return layaway;
    });
  }

  async getLayaways(status?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = {};
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
      where: { id },
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
    const layaway = await this.prisma.layaway.findUnique({ where: { id } });
    if (!layaway) throw new NotFoundException('Layaway not found.');
    if (layaway.status !== 'ACTIVE') {
      throw new BadRequestException('This layaway is no longer active.');
    }
    if (dto.amount > Number(layaway.balanceDue)) {
      throw new BadRequestException('Payment exceeds balance due.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          layawayId: id,
          amount: dto.amount,
          method: dto.method,
          status: 'COMPLETED',
          transactionRef: dto.transactionRef,
        },
      });

      const newDepositPaid = Number(layaway.depositPaid) + dto.amount;
      const newBalanceDue = Number(layaway.total) - newDepositPaid;

      return tx.layaway.update({
        where: { id },
        data: {
          depositPaid: newDepositPaid,
          balanceDue: newBalanceDue,
        },
        include: { payments: true },
      });
    });
  }

  async completeLayaway(id: string, cashierId: string) {
    const layaway = await this.prisma.layaway.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!layaway) throw new NotFoundException('Layaway not found.');
    if (layaway.status !== 'ACTIVE') {
      throw new BadRequestException('This layaway is no longer active.');
    }
    if (Number(layaway.balanceDue) > 0) {
      throw new BadRequestException(
        `Outstanding balance of ${layaway.balanceDue}. Full payment required before completion.`,
      );
    }

    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN' },
    });

    const items = layaway.items as any[];

    // Validate stock
    for (const item of items) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: item.variantId },
      });
      if (!variant || variant.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${item.productName} (${item.variantName}).`,
        );
      }
    }

    const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      // Create order from layaway
      const order = await tx.order.create({
        data: {
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
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.unitPrice * item.quantity - (item.itemDiscount ?? 0),
            })),
          },
        },
      });

      // Deduct stock
      for (const item of items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
        });
        const newStock = variant!.stock - item.quantity;
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: newStock },
        });
        await tx.inventoryTransaction.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            type: 'SALE',
            quantityBefore: variant!.stock,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
            reference: orderNumber,
            note: `Layaway completion: ${layaway.layawayNumber}`,
            performedBy: cashierId,
          },
        });
      }

      // Mark layaway complete
      await tx.layaway.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

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
    const layaway = await this.prisma.layaway.findUnique({ where: { id } });
    if (!layaway) throw new NotFoundException('Layaway not found.');
    if (layaway.status !== 'ACTIVE') {
      throw new BadRequestException('This layaway is no longer active.');
    }

    return this.prisma.layaway.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  // ============================================================
  // EXCHANGE
  // ============================================================

  async createExchange(dto: CreateExchangeDto, cashierId: string) {
    const originalOrder = await this.prisma.order.findUnique({
      where: { id: dto.originalOrderId },
      include: { items: { include: { variant: true, product: true } } },
    });
    if (!originalOrder) throw new NotFoundException('Original order not found.');

    const session = await this.prisma.posSession.findFirst({
      where: { adminUserId: cashierId, status: 'OPEN' },
    });

    // Calculate return total
    let returnTotal = 0;
    const returnItemDetails: any[] = [];
    for (const ri of dto.returnedItems) {
      const orderItem = originalOrder.items.find((i) => i.id === ri.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(`Order item ${ri.orderItemId} not found.`);
      }
      if (ri.quantity > orderItem.quantity) {
        throw new BadRequestException(`Cannot return more than purchased for item ${ri.orderItemId}.`);
      }
      returnTotal += Number(orderItem.unitPrice) * ri.quantity;
      returnItemDetails.push({
        orderItemId: ri.orderItemId,
        productId: orderItem.productId,
        variantId: orderItem.variantId,
        productName: orderItem.product.name,
        variantName: orderItem.variant.name,
        quantity: ri.quantity,
        unitPrice: Number(orderItem.unitPrice),
      });
    }

    // Calculate new items total & validate stock
    let newTotal = 0;
    for (const ni of dto.newItems) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: ni.variantId },
        include: { product: { select: { name: true } } },
      });
      if (!variant) throw new BadRequestException(`Variant ${ni.variantId} not found.`);
      if (variant.stock < ni.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${variant.product.name} (${variant.name}).`,
        );
      }
      newTotal += ni.unitPrice * ni.quantity;
    }

    const priceDifference = newTotal - returnTotal; // positive = customer owes more
    const exchangeNumber = `EXC-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.$transaction(async (tx) => {
      // Restock returned items
      for (const ri of returnItemDetails) {
        const variant = await tx.productVariant.findUnique({ where: { id: ri.variantId } });
        const newStock = variant!.stock + ri.quantity;
        await tx.productVariant.update({
          where: { id: ri.variantId },
          data: { stock: newStock },
        });
        await tx.inventoryTransaction.create({
          data: {
            productId: ri.productId,
            variantId: ri.variantId,
            type: 'ADJUSTMENT',
            quantityBefore: variant!.stock,
            quantityChange: ri.quantity,
            quantityAfter: newStock,
            reference: exchangeNumber,
            note: `Exchange return`,
            performedBy: cashierId,
          },
        });
      }

      // Deduct stock for new items
      let newOrderId: string | null = null;
      if (dto.newItems.length > 0) {
        const orderNumber = `POS-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const newOrder = await tx.order.create({
          data: {
            orderNumber,
            userId: originalOrder.userId,
            status: 'DELIVERED',
            subtotal: newTotal,
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
              create: dto.newItems.map((ni) => ({
                productId: ni.productId,
                variantId: ni.variantId,
                quantity: ni.quantity,
                unitPrice: ni.unitPrice,
                total: ni.unitPrice * ni.quantity,
              })),
            },
          },
        });
        newOrderId = newOrder.id;

        for (const ni of dto.newItems) {
          const variant = await tx.productVariant.findUnique({ where: { id: ni.variantId } });
          const newStock = variant!.stock - ni.quantity;
          await tx.productVariant.update({
            where: { id: ni.variantId },
            data: { stock: newStock },
          });
          await tx.inventoryTransaction.create({
            data: {
              productId: ni.productId,
              variantId: ni.variantId,
              type: 'SALE',
              quantityBefore: variant!.stock,
              quantityChange: -ni.quantity,
              quantityAfter: newStock,
              reference: exchangeNumber,
              note: `Exchange new item`,
              performedBy: cashierId,
            },
          });
        }
      }

      // Create exchange record
      const exchange = await tx.posExchange.create({
        data: {
          exchangeNumber,
          originalOrderId: dto.originalOrderId,
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
          settlementAmount: priceDifference > 0 ? priceDifference : Math.abs(priceDifference),
          reason: dto.reason,
          note: dto.note,
        },
      });

      return exchange;
    });
  }

  async getExchanges(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.posExchange.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.posExchange.count(),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getExchange(id: string) {
    const exchange = await this.prisma.posExchange.findUnique({ where: { id } });
    if (!exchange) throw new NotFoundException('Exchange not found.');
    return exchange;
  }

  // ============================================================
  // DAILY SUMMARY
  // ============================================================

  async getDailySummary(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await this.prisma.order.findMany({
      where: {
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
        if (payment.status === 'REFUNDED') {
          totalRefunds += Number(payment.amount);
        }
      }
    }

    return {
      date: startOfDay.toISOString().split('T')[0],
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
