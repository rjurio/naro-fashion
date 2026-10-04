import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateOrderDto, DeliveryMethod, PaymentMethod } from './dto/create-order.dto';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import {
  CANCELLABLE_STATUSES,
  MONEY_COLLECTED_PAYMENT_STATUSES,
  OPEN_ORDER_STATUSES,
  releasePromoUsage,
  resolveDeliveryFee,
  restockOrderItems,
} from './order-lifecycle.util';
import { QueryOrdersDto, AdminQueryOrdersDto } from './dto/query-orders.dto';
import { ownerScope, isAdminUser } from '../auth/util/ownership';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
    private readonly promoCodesService: PromoCodesService,
  ) {}

  private generateOrderNumber(): string {
    const random = Math.floor(1000 + Math.random() * 9000);
    return `NARO-${Date.now()}-${random}`;
  }

  /** Expose `shippingFee` (contract name) alongside the `shippingCost` column. */
  private withShippingFee<T extends { shippingCost?: any }>(order: T): T & { shippingFee: number } {
    return { ...order, shippingFee: Number(order?.shippingCost ?? 0) };
  }

  private maxOpenCodOrders(): number {
    const n = Number(process.env.MAX_OPEN_COD_ORDERS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
  }

  /**
   * Checkout. Everything that reads or mutates shared state happens inside
   * ONE transaction, serialized per customer with a transaction-scoped
   * advisory lock:
   *   lock(user) → read cart → validate lines → price (flash sale) →
   *   promo → reserve stock (guarded decrement) → create order →
   *   record promo usage (guarded increment) → clear cart.
   * A double-submit therefore can't create two orders: the second request
   * waits on the lock and then finds an empty cart.
   */
  async create(userId: string, dto: CreateOrderDto) {
    const tenantId = this.tenantContext.requireId;
    const deliveryMethod = dto.deliveryMethod ?? DeliveryMethod.STANDARD;

    // Address is optional. An addressId must belong to the user; an inline
    // shippingAddress is persisted as a new Address row inside the tx.
    if (dto.addressId) {
      const address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, userId, user: { tenantId } },
        select: { id: true },
      });
      if (!address) {
        throw new NotFoundException('Address not found');
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Per-customer serialization (namespace key + user key).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('naro:order-create'), hashtext(${userId}::text))`;

      const cartItems = await tx.cartItem.findMany({
        where: { userId },
        include: { variant: { include: { product: true } } },
        orderBy: { createdAt: 'asc' },
      });
      if (cartItems.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      // Cap open unpaid cash-on-delivery orders per customer (abuse guard:
      // COD orders reserve stock without any payment).
      if (dto.paymentMethod === PaymentMethod.CASH_ON_DELIVERY) {
        const openCod = await tx.order.count({
          where: {
            tenantId,
            userId,
            paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
            status: { in: OPEN_ORDER_STATUSES },
            paymentStatus: { notIn: MONEY_COLLECTED_PAYMENT_STATUSES },
          },
        });
        const cap = this.maxOpenCodOrders();
        if (openCod >= cap) {
          throw new BadRequestException(
            `You already have ${openCod} open cash-on-delivery orders. Please complete or cancel one before placing another.`,
          );
        }
      }

      // Validate every line. productId is ALWAYS derived from the variant —
      // never trust CartItem.productId.
      for (const item of cartItems) {
        const v = item.variant;
        const p = v?.product;
        if (!v || v.tenantId !== tenantId || !p || p.tenantId !== tenantId) {
          throw new BadRequestException('An item in your cart is no longer available. Please review your cart.');
        }
        if (!v.isActive || !p.isActive || p.deletedAt || p.archivedAt) {
          throw new BadRequestException(`${p.name} is no longer available. Please remove it from your cart.`);
        }
        if (p.availabilityMode === 'RENTAL_ONLY') {
          throw new BadRequestException(`${p.name} is available for rental only.`);
        }
        if (item.quantity < 1) {
          throw new BadRequestException('Invalid quantity in cart');
        }
      }

      // Active flash-sale prices (lowest active salePrice per product). The
      // FlashSaleItem model has no per-item stock limit, so there is nothing
      // to decrement beyond the normal variant stock.
      const productIds = Array.from(new Set(cartItems.map((i) => i.variant.productId)));
      const now = new Date();
      const saleItems = await tx.flashSaleItem.findMany({
        where: {
          productId: { in: productIds },
          flashSale: { tenantId, isActive: true, deletedAt: null, startDate: { lte: now }, endDate: { gte: now } },
        },
        select: { productId: true, salePrice: true },
      });
      const salePriceByProduct = new Map<string, number>();
      for (const s of saleItems) {
        const price = Number(s.salePrice);
        const prev = salePriceByProduct.get(s.productId);
        if (prev === undefined || price < prev) salePriceByProduct.set(s.productId, price);
      }

      const lines = cartItems.map((item) => {
        const variantPrice = Number(item.variant.price);
        const sale = salePriceByProduct.get(item.variant.productId);
        const unitPrice = sale !== undefined && sale >= 0 && sale < variantPrice ? sale : variantPrice;
        return {
          productId: item.variant.productId,
          productName: item.variant.product.name,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice,
          total: unitPrice * item.quantity,
        };
      });
      const subtotal = lines.reduce((sum, l) => sum + l.total, 0);

      // Promo code — validated against the same transaction snapshot; an
      // invalid code is a 400 (never silently dropped, so the customer is
      // never charged a price they didn't see).
      let discount = 0;
      let promoCodeId: string | null = null;
      if (dto.promoCode && dto.promoCode.trim()) {
        const moduleOn = await tx.tenantModule.findFirst({
          where: { tenantId, moduleCode: 'promo-codes', isEnabled: true },
          select: { id: true },
        });
        if (!moduleOn) {
          throw new BadRequestException('Promo codes are not available for this shop');
        }
        const evaluation = await this.promoCodesService.evaluate(tx, tenantId, dto.promoCode, subtotal, userId);
        if (!evaluation.valid || !evaluation.promo) {
          throw new BadRequestException(evaluation.message);
        }
        discount = Math.min(evaluation.discount, subtotal);
        promoCodeId = evaluation.promo.id;
      }

      const shippingCost = await resolveDeliveryFee(tx, tenantId, deliveryMethod);
      const total = Math.max(0, subtotal - discount) + shippingCost;

      // Reserve stock: atomic guarded decrement per line. Any shortfall
      // rolls back the whole transaction — no order, cart untouched.
      for (const line of lines) {
        const dec = await tx.productVariant.updateMany({
          where: { id: line.variantId, tenantId, isActive: true, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (dec.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for ${line.productName}. Only limited quantity is available.`,
          );
        }
        const after = await tx.productVariant.findFirst({
          where: { id: line.variantId, tenantId },
          select: { stock: true },
        });
        const quantityAfter = after?.stock ?? 0;
        await tx.inventoryTransaction.create({
          data: {
            tenantId,
            productId: line.productId,
            variantId: line.variantId,
            type: 'SALE',
            quantityBefore: quantityAfter + line.quantity,
            quantityChange: -line.quantity,
            quantityAfter,
            note: 'Online order',
            performedBy: null,
          },
        });
      }

      let addressId: string | null = dto.addressId || null;
      let notes = dto.notes;
      if (!addressId && dto.shippingAddress && deliveryMethod !== DeliveryMethod.PICKUP) {
        const a = dto.shippingAddress;
        const created = await tx.address.create({
          data: {
            userId,
            label: 'Checkout',
            fullName: a.name.trim(),
            phone: a.phone.trim(),
            street: a.street.trim(),
            city: a.city.trim(),
            region: a.region.trim(),
          },
          select: { id: true },
        });
        addressId = created.id;
        if (!notes || !notes.trim()) {
          notes = `Ship to: ${a.name}, ${a.phone}, ${a.street}, ${a.city}, ${a.region}`;
        }
      }
      if (deliveryMethod !== DeliveryMethod.STANDARD) {
        const tag = `Delivery: ${deliveryMethod}`;
        notes = notes && notes.trim() ? `${tag}\n${notes}` : tag;
      }

      const newOrder = await tx.order.create({
        data: {
          tenantId,
          orderNumber: this.generateOrderNumber(),
          userId,
          addressId,
          status: 'PENDING',
          subtotal,
          shippingCost,
          discount,
          total,
          paymentMethod: dto.paymentMethod,
          paymentStatus: 'PENDING',
          promoCodeId,
          notes,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              quantity: l.quantity,
              unitPrice: new Prisma.Decimal(l.unitPrice),
              total: new Prisma.Decimal(l.total),
            })),
          },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, slug: true } },
              variant: {
                select: { id: true, name: true, size: true, color: true },
              },
            },
          },
          address: true,
        },
      });

      if (promoCodeId) {
        // Guarded increment (usedCount < maxUses) + usage row, same tx.
        await this.promoCodesService.recordUsage(promoCodeId, userId, newOrder.id, tx);
      }

      await tx.cartItem.deleteMany({ where: { userId } });

      return newOrder;
    }, { maxWait: 10000, timeout: 20000 });

    return this.withShippingFee(order);
  }
  async findAll(userId: string, query: QueryOrdersDto) {
    const { status, page = 1, limit = 20 } = query;

    const where: any = { tenantId: this.tenantContext.requireId, userId };
    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, slug: true },
              },
              variant: {
                select: { id: true, name: true, size: true, color: true },
              },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this.withShippingFee(o)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAllAdmin(query: AdminQueryOrdersDto) {
    const { search, status, startDate, endDate, page = 1, limit = 20 } = query;

    const where: any = { tenantId: this.tenantContext.requireId };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          items: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
          address: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this.withShippingFee(o)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, user: any) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId: this.tenantContext.requireId, ...ownerScope(user) },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        address: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: { where: { isPrimary: true }, take: 1 },
              },
            },
            variant: {
              select: { id: true, name: true, sku: true, size: true, color: true },
            },
          },
        },
        payments: true,
        shipment: true,
        invoice: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.withShippingFee(order);
  }

  async updateStatus(id: string, status: string, user: any) {
    const tenantId = this.tenantContext.requireId;
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, ...ownerScope(user) },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const admin = isAdminUser(user);

    // Customers can only cancel their own orders. Any other transition
    // requires admin privileges.
    if (!admin && status !== 'CANCELLED') {
      throw new ForbiddenException(
        'Only admins can change order status to anything other than CANCELLED',
      );
    }

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'CANCELLED'],
      PROCESSING: ['SHIPPED', 'CANCELLED'],
      SHIPPED: ['DELIVERED'],
      DELIVERED: [],
      CANCELLED: [],
    };

    const allowed = validTransitions[order.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${status}`,
      );
    }

    if (status === 'CANCELLED') {
      const moneyCollected = MONEY_COLLECTED_PAYMENT_STATUSES.includes(order.paymentStatus);
      if (!admin && moneyCollected) {
        throw new BadRequestException('Paid orders must be cancelled by the shop');
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        // Conditional flip: only the request that actually moves the row out
        // of a cancellable status restocks. Guarding on the paymentStatus we
        // read also stops a customer cancel racing a payment completion.
        const flipped = await tx.order.updateMany({
          where: {
            id,
            tenantId,
            ...ownerScope(user),
            status: { in: CANCELLABLE_STATUSES },
            paymentStatus: order.paymentStatus,
          },
          data: {
            status: 'CANCELLED',
            // Admin cancelling a paid order → money must go back.
            paymentStatus: moneyCollected ? 'REFUND_PENDING' : 'CANCELLED',
          },
        });
        if (flipped.count !== 1) {
          throw new ConflictException('Order was updated by someone else. Please refresh and try again.');
        }

        // POS orders manage stock via their own sale/refund flow (and are
        // created DELIVERED, so they never reach this transition).
        if (order.channel !== 'POS') {
          await restockOrderItems(tx, id, tenantId, 'Order cancelled — reserved stock restored');
        }
        await releasePromoUsage(tx, order, tenantId);

        return tx.order.findFirst({
          where: { id, tenantId },
          include: { items: true, payments: true },
        });
      });
      await this.auditService.log('UPDATE_STATUS', 'Order', id, { from: order.status, to: status });
      return updated ? this.withShippingFee(updated) : updated;
    }

    // Non-cancel transitions: compare-and-swap on the status we validated.
    const flipped = await this.prisma.order.updateMany({
      where: { id, tenantId, status: order.status },
      data: { status },
    });
    if (flipped.count !== 1) {
      throw new ConflictException('Order was updated by someone else. Please refresh and try again.');
    }
    const updated = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        items: true,
        payments: true,
      },
    });
    await this.auditService.log('UPDATE_STATUS', 'Order', id, { from: order.status, to: status });
    return updated ? this.withShippingFee(updated) : updated;
  }
  /**
   * Append a timestamped, admin-attributed note to Order.notes. Reversible
   * (admin can edit the field manually), so the AI agent does not require
   * approval for this operation in Phase 2.
   *
   * Note shape:
   *   [2026-05-10T17:30:00.000Z — Faith Urio] Customer requested express delivery
   */
  async addNote(orderId: string, note: string, user: any) {
    const tenantId = this.tenantContext.requireId;
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, notes: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const trimmed = note.trim();
    if (!trimmed) {
      throw new BadRequestException('Note cannot be empty');
    }

    const adminLabel =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      'admin';
    const annotated = `[${new Date().toISOString()} — ${adminLabel}] ${trimmed}`;
    const newNotes = order.notes ? `${order.notes}\n${annotated}` : annotated;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { notes: newNotes },
      select: { id: true, notes: true },
    });
    await this.auditService.log('ADD_NOTE', 'Order', orderId, {
      noteLength: trimmed.length,
    });
    return updated;
  }

  async getStats() {
    const tenantId = this.tenantContext.requireId;
    const [statusCounts, revenueResult] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { id: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const item of statusCounts) {
      byStatus[item.status] = item._count.id;
    }

    return {
      byStatus,
      totalOrders: revenueResult._count.id,
      totalRevenue: revenueResult._sum.total || 0,
    };
  }
}
