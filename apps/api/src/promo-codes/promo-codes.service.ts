import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { Prisma, PromoCode } from '@prisma/client';
import { CreatePromoCodeDto, ValidatePromoCodeDto } from './dto/create-promo-code.dto';

export interface PromoEvaluation {
  valid: boolean;
  discount: number;
  message: string;
  promo?: PromoCode;
}

@Injectable()
export class PromoCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async create(dto: CreatePromoCodeDto, createdBy?: string) {
    const tenantId = this.tenantContext.requireId;

    const existing = await this.prisma.promoCode.findFirst({
      where: { code: dto.code.toUpperCase(), tenantId },
    });
    if (existing) {
      throw new ConflictException(`Promo code "${dto.code}" already exists`);
    }

    return this.prisma.promoCode.create({
      data: {
        tenantId,
        code: dto.code.toUpperCase(),
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        minOrderAmount: dto.minOrderAmount,
        maxDiscountAmount: dto.maxDiscountAmount,
        maxUses: dto.maxUses,
        maxUsesPerUser: dto.maxUsesPerUser ?? 1,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : new Date(),
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        isActive: dto.isActive ?? true,
        createdBy,
      },
    });
  }

  async findAll() {
    const tenantId = this.tenantContext.requireId;

    return this.prisma.promoCode.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { usages: true } } },
    });
  }

  async findOne(id: string) {
    const tenantId = this.tenantContext.requireId;

    const promo = await this.prisma.promoCode.findFirst({
      where: { id, tenantId },
      include: {
        usages: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: { select: { usages: true, orders: true } },
      },
    });
    if (!promo) throw new NotFoundException('Promo code not found');
    return promo;
  }

  /**
   * Pure promo evaluation shared by the public validate endpoint and order
   * creation. Never throws for a business-rule failure — returns
   * `{ valid: false, discount: 0, message }` so callers decide (the validate
   * endpoint returns it as-is; OrdersService turns it into a 400).
   *
   * `db` may be a transaction client so order creation evaluates against the
   * same snapshot it then writes in.
   */
  async evaluate(
    db: Pick<Prisma.TransactionClient, 'promoCode' | 'promoCodeUsage'>,
    tenantId: string,
    code: string,
    subtotal: number,
    userId?: string,
  ): Promise<PromoEvaluation> {
    const invalid = (message: string): PromoEvaluation => ({ valid: false, discount: 0, message });
    const normalized = (code || '').trim().toUpperCase();
    if (!normalized) return invalid('Invalid promo code');

    const promo = await db.promoCode.findFirst({ where: { code: normalized, tenantId } });
    if (!promo) return invalid('Invalid promo code');
    if (!promo.isActive) return invalid('This promo code is no longer active');

    const now = new Date();
    if (promo.validFrom > now) return invalid('This promo code is not yet valid');
    if (promo.validUntil && promo.validUntil < now) return invalid('This promo code has expired');
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return invalid('This promo code has reached its usage limit');
    }
    if (promo.minOrderAmount && subtotal < Number(promo.minOrderAmount)) {
      return invalid(`Minimum order amount of TZS ${Number(promo.minOrderAmount).toLocaleString()} required`);
    }
    if (userId) {
      const userUsageCount = await db.promoCodeUsage.count({ where: { promoCodeId: promo.id, userId } });
      if (userUsageCount >= promo.maxUsesPerUser) return invalid('You have already used this promo code');
    }

    let discount: number;
    if (promo.discountType === 'PERCENTAGE') {
      discount = subtotal * (Number(promo.discountValue) / 100);
      if (promo.maxDiscountAmount && discount > Number(promo.maxDiscountAmount)) {
        discount = Number(promo.maxDiscountAmount);
      }
    } else {
      discount = Number(promo.discountValue);
    }
    // Never exceed the subtotal, never negative.
    discount = Math.max(0, Math.min(Math.round(discount), Math.round(subtotal)));

    return { valid: true, discount, message: 'Promo code applied', promo };
  }

  /**
   * POST /promo-codes/validate. Contract: `{ valid, discount, message }`
   * (HTTP 200 for both valid and invalid codes). Legacy fields
   * (`discountAmount`, `promoCodeId`, `code`, ...) kept for older clients.
   */
  async validate(dto: ValidatePromoCodeDto, userId?: string) {
    const tenantId = this.tenantContext.requireId;
    const subtotal = Number(dto.subtotal ?? dto.orderAmount ?? 0);
    const result = await this.evaluate(this.prisma, tenantId, dto.code, subtotal, userId);
    if (!result.valid || !result.promo) {
      return { valid: false, discount: 0, discountAmount: 0, message: result.message };
    }
    const promo = result.promo;
    return {
      valid: true,
      discount: result.discount,
      message: result.message,
      promoCodeId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: Number(promo.discountValue),
      discountAmount: result.discount,
      description: promo.description,
    };
  }

  /**
   * Record one redemption. Pass the order transaction as `tx` so the usage
   * row + counter bump commit/roll back with the order. The increment is
   * guarded (`usedCount < maxUses`) so two concurrent orders can't both take
   * the last use — the loser gets a 400 and its whole transaction rolls back.
   */
  async recordUsage(promoCodeId: string, userId: string, orderId: string, tx?: Prisma.TransactionClient) {
    const tenantId = this.tenantContext.requireId;
    const run = async (db: Prisma.TransactionClient) => {
      const promo = await db.promoCode.findFirst({
        where: { id: promoCodeId, tenantId },
        select: { id: true, maxUses: true },
      });
      if (!promo) throw new NotFoundException('Promo code not found');
      const inc = await db.promoCode.updateMany({
        where: {
          id: promo.id,
          tenantId,
          ...(promo.maxUses != null ? { usedCount: { lt: promo.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (inc.count === 0) {
        throw new BadRequestException('This promo code has reached its usage limit');
      }
      await db.promoCodeUsage.create({ data: { promoCodeId: promo.id, userId, orderId } });
    };
    if (tx) return run(tx);
    return this.prisma.$transaction((t) => run(t));
  }
  async update(id: string, dto: Partial<CreatePromoCodeDto>) {
    const tenantId = this.tenantContext.requireId;

    const promo = await this.prisma.promoCode.findFirst({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException('Promo code not found');

    return this.prisma.promoCode.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.discountType && { discountType: dto.discountType }),
        ...(dto.discountValue !== undefined && { discountValue: dto.discountValue }),
        ...(dto.minOrderAmount !== undefined && { minOrderAmount: dto.minOrderAmount }),
        ...(dto.maxDiscountAmount !== undefined && { maxDiscountAmount: dto.maxDiscountAmount }),
        ...(dto.maxUses !== undefined && { maxUses: dto.maxUses }),
        ...(dto.maxUsesPerUser !== undefined && { maxUsesPerUser: dto.maxUsesPerUser }),
        ...(dto.validFrom && { validFrom: new Date(dto.validFrom) }),
        ...(dto.validUntil && { validUntil: new Date(dto.validUntil) }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string) {
    const tenantId = this.tenantContext.requireId;

    const promo = await this.prisma.promoCode.findFirst({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException('Promo code not found');
    return this.prisma.promoCode.delete({ where: { id } });
  }
}
