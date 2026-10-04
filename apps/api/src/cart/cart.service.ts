import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartItemDto } from './dto/merge-cart.dto';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  private readonly cartItemInclude = {
    product: {
      select: {
        id: true,
        name: true,
        slug: true,
        basePrice: true,
        compareAtPrice: true,
        images: true,
        isActive: true,
      },
    },
    variant: {
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        stock: true,
      },
    },
  };

  async getCart(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: this.cartItemInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { items };
  }

  /**
   * Resolve a purchasable variant for the caller's tenant.
   *
   *  - variant must belong to the current tenant (cross-tenant ids → 404)
   *  - variant AND its product must be live (isActive, not deleted/archived)
   *  - RENTAL_ONLY products can't go in the purchase cart
   *  - if the client also sent a productId it must match variant.productId;
   *    the stored CartItem.productId is ALWAYS derived from the variant so a
   *    mismatched pair can never reach order creation.
   */
  async resolvePurchasableVariant(variantId: string, claimedProductId?: string) {
    const tenantId = this.tenantContext.requireId;
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: {
        id: true,
        productId: true,
        isActive: true,
        product: {
          select: { id: true, tenantId: true, isActive: true, deletedAt: true, archivedAt: true, availabilityMode: true },
        },
      },
    });
    if (!variant || variant.product?.tenantId !== tenantId) {
      throw new NotFoundException('Product variant not found');
    }
    if (claimedProductId && claimedProductId !== variant.productId) {
      throw new BadRequestException('Variant does not belong to the given product');
    }
    const p = variant.product;
    if (!variant.isActive || !p.isActive || p.deletedAt || p.archivedAt) {
      throw new BadRequestException('This product is no longer available');
    }
    if (p.availabilityMode === 'RENTAL_ONLY') {
      throw new BadRequestException('This product is available for rental only');
    }
    return variant;
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const variant = await this.resolvePurchasableVariant(dto.variantId, dto.productId);

    const existing = await this.prisma.cartItem.findFirst({
      where: {
        userId,
        variantId: variant.id,
      },
    });

    if (existing) {
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          productId: variant.productId,
          quantity: existing.quantity + (dto.quantity ?? 1),
          notes: dto.notes ?? existing.notes,
        },
        include: this.cartItemInclude,
      });
    }

    return this.prisma.cartItem.create({
      data: {
        userId,
        productId: variant.productId,
        variantId: variant.id,
        quantity: dto.quantity ?? 1,
        notes: dto.notes,
      },
      include: this.cartItemInclude,
    });
  }
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
      include: this.cartItemInclude,
    });
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return { message: 'Item removed from cart' };
  }

  async clearCart(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return { message: 'Cart cleared' };
  }

  async getCartCount(userId: string) {
    const result = await this.prisma.cartItem.aggregate({
      where: { userId },
      _sum: { quantity: true },
    });

    return { count: result._sum.quantity ?? 0 };
  }

  async mergeGuestCart(userId: string, items: MergeCartItemDto[]) {
    for (const item of items) {
      // Guest carts come from localStorage — silently drop lines whose
      // variant isn't a live, same-tenant, purchasable variant.
      let variant: { id: string; productId: string };
      try {
        variant = await this.resolvePurchasableVariant(item.variantId, item.productId);
      } catch {
        continue;
      }
      const existing = await this.prisma.cartItem.findFirst({
        where: {
          userId,
          variantId: variant.id,
        },
      });

      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity: Math.max(existing.quantity, item.quantity),
            notes: item.notes ?? existing.notes,
          },
        });
      } else {
        await this.prisma.cartItem.create({
          data: {
            userId,
            productId: variant.productId,
            variantId: variant.id,
            quantity: item.quantity,
            notes: item.notes,
          },
        });
      }
    }

    return this.getCart(userId);
  }
}
