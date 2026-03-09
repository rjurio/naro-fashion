import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewsDto } from './dto/query-reviews.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.review.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) {
      throw new ConflictException(
        'You have already reviewed this product',
      );
    }

    // Check if user purchased this product
    const hasPurchased = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: 'DELIVERED' },
      },
    });

    const review = await this.prisma.review.create({
      data: {
        userId,
        productId,
        rating: dto.rating,
        title: dto.title,
        comment: dto.comment,
        isVerified: !!hasPurchased,
      },
      include: {
        user: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });

    await this.updateProductRatingStats(productId);
    return review;
  }

  async findByProduct(productId: string, query: QueryReviewsDto) {
    const { sort, page = 1, limit = 10 } = query;
    const where = { productId, isApproved: true };

    let orderBy: any = { createdAt: 'desc' };
    switch (sort) {
      case 'oldest':
        orderBy = { createdAt: 'asc' };
        break;
      case 'highest':
        orderBy = { rating: 'desc' };
        break;
      case 'lowest':
        orderBy = { rating: 'asc' };
        break;
    }

    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: {
            select: { firstName: true, lastName: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data: reviews,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        user: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  async update(userId: string, id: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.userId !== userId) {
      throw new ForbiddenException('You can only update your own reviews');
    }

    const data: any = {};
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.comment !== undefined) data.comment = dto.comment;

    const updated = await this.prisma.review.update({
      where: { id },
      data,
      include: {
        user: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });

    await this.updateProductRatingStats(review.productId);
    return updated;
  }

  async delete(userId: string, id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.userId !== userId) {
      throw new ForbiddenException('You can only delete your own reviews');
    }

    await this.prisma.review.delete({ where: { id } });
    await this.updateProductRatingStats(review.productId);
    return { message: 'Review deleted' };
  }

  async approve(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    const updated = await this.prisma.review.update({
      where: { id },
      data: { isApproved: true },
    });

    await this.updateProductRatingStats(review.productId);
    return updated;
  }

  async reject(id: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    await this.prisma.review.delete({ where: { id } });
    await this.updateProductRatingStats(review.productId);
    return { message: 'Review rejected and deleted' };
  }

  async getStats(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const distribution = await Promise.all(
      [1, 2, 3, 4, 5].map(async (rating) => ({
        rating,
        count: await this.prisma.review.count({
          where: { productId, rating, isApproved: true },
        }),
      })),
    );

    return {
      productId,
      avgRating: product.avgRating,
      reviewCount: product.reviewCount,
      distribution,
    };
  }

  private async updateProductRatingStats(productId: string) {
    const stats = await this.prisma.review.aggregate({
      where: { productId, isApproved: true },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        avgRating: stats._avg.rating ?? 0,
        reviewCount: stats._count.rating,
      },
    });
  }
}
