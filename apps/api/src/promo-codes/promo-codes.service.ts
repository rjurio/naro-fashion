import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreatePromoCodeDto, ValidatePromoCodeDto } from './dto/create-promo-code.dto';

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

  async validate(dto: ValidatePromoCodeDto, userId?: string) {
    const tenantId = this.tenantContext.requireId;

    const promo = await this.prisma.promoCode.findFirst({
      where: { code: dto.code.toUpperCase(), tenantId },
    });

    if (!promo) {
      throw new NotFoundException('Invalid promo code');
    }

    if (!promo.isActive) {
      throw new BadRequestException('This promo code is no longer active');
    }

    const now = new Date();
    if (promo.validFrom > now) {
      throw new BadRequestException('This promo code is not yet valid');
    }
    if (promo.validUntil && promo.validUntil < now) {
      throw new BadRequestException('This promo code has expired');
    }

    if (promo.maxUses && promo.usedCount >= promo.maxUses) {
      throw new BadRequestException('This promo code has reached its usage limit');
    }

    if (promo.minOrderAmount && dto.orderAmount < Number(promo.minOrderAmount)) {
      throw new BadRequestException(
        `Minimum order amount of TZS ${Number(promo.minOrderAmount).toLocaleString()} required`,
      );
    }

    // Check per-user usage limit
    if (userId) {
      const userUsageCount = await this.prisma.promoCodeUsage.count({
        where: { promoCodeId: promo.id, userId },
      });
      if (userUsageCount >= promo.maxUsesPerUser) {
        throw new BadRequestException('You have already used this promo code');
      }
    }

    // Calculate discount
    let discountAmount: number;
    if (promo.discountType === 'PERCENTAGE') {
      discountAmount = dto.orderAmount * (Number(promo.discountValue) / 100);
      if (promo.maxDiscountAmount && discountAmount > Number(promo.maxDiscountAmount)) {
        discountAmount = Number(promo.maxDiscountAmount);
      }
    } else {
      discountAmount = Number(promo.discountValue);
    }

    // Don't exceed order amount
    discountAmount = Math.min(discountAmount, dto.orderAmount);

    return {
      valid: true,
      promoCodeId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: Number(promo.discountValue),
      discountAmount: Math.round(discountAmount),
      description: promo.description,
    };
  }

  async recordUsage(promoCodeId: string, userId: string, orderId: string) {
    const tenantId = this.tenantContext.requireId;

    await this.prisma.$transaction([
      this.prisma.promoCodeUsage.create({
        data: { promoCodeId, userId, orderId },
      }),
      this.prisma.promoCode.update({
        where: { id: promoCodeId },
        data: { usedCount: { increment: 1 } },
      }),
    ]);
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
