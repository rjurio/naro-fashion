import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartItemDto } from './dto/merge-cart.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

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

  async addItem(userId: string, dto: AddCartItemDto) {
    const existing = await this.prisma.cartItem.findUnique({
      where: {
        userId_variantId: {
          userId,
          variantId: dto.variantId,
        },
      },
    });

    if (existing) {
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + (dto.quantity ?? 1),
          notes: dto.notes ?? existing.notes,
        },
        include: this.cartItemInclude,
      });
    }

    return this.prisma.cartItem.create({
      data: {
        userId,
        productId: dto.productId,
        variantId: dto.variantId,
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
      const existing = await this.prisma.cartItem.findUnique({
        where: {
          userId_variantId: {
            userId,
            variantId: item.variantId,
          },
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
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            notes: item.notes,
          },
        });
      }
    }

    return this.getCart(userId);
  }
}
