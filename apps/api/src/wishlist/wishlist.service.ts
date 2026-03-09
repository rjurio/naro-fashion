import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly wishlistItemInclude = {
    product: {
      select: {
        id: true,
        name: true,
        slug: true,
        basePrice: true,
        compareAtPrice: true,
        images: true,
        isActive: true,
        category: { select: { id: true, name: true, slug: true } },
      },
    },
  };

  async getWishlist(userId: string) {
    const items = await this.prisma.wishlistItem.findMany({
      where: { userId },
      include: this.wishlistItemInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { items };
  }

  async addItem(userId: string, productId: string) {
    const existing = await this.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (existing) {
      await this.prisma.wishlistItem.delete({ where: { id: existing.id } });
      return { added: false, message: 'Removed from wishlist' };
    }

    await this.prisma.wishlistItem.create({
      data: { userId, productId },
    });

    return { added: true, message: 'Added to wishlist' };
  }

  async removeItem(userId: string, productId: string) {
    const existing = await this.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (existing) {
      await this.prisma.wishlistItem.delete({ where: { id: existing.id } });
    }

    return { message: 'Removed from wishlist' };
  }

  async isInWishlist(userId: string, productId: string) {
    const item = await this.prisma.wishlistItem.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    return { inWishlist: !!item };
  }

  async getWishlistCount(userId: string) {
    const count = await this.prisma.wishlistItem.count({
      where: { userId },
    });

    return { count };
  }
}
