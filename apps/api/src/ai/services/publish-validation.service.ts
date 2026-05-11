import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * publish_product pre-flight validation — Phase 3.1A.
 *
 * Runs at request-approval time so the operator sees real errors BEFORE
 * an approver wastes a click. Same checks repeat at execute time only as
 * a defence-in-depth — the canonical guard is here.
 *
 * Rules:
 *   - product exists in the caller's tenant
 *   - product NOT soft-deleted
 *   - product currently inactive (publishing an already-live product is a no-op
 *     and would clobber the audit chain; refuse it explicitly)
 *   - product has the customer-facing fields a published listing requires:
 *       name, slug, category, at least one ProductImage, basePrice > 0
 *   - per availabilityMode:
 *       PURCHASE_ONLY → at least one active ProductVariant
 *       RENTAL_ONLY   → rentalPricePerDay > 0
 *       BOTH          → at least one active ProductVariant AND rentalPricePerDay > 0
 *
 * Returns the loaded product + image-count + variant-count so callers
 * don't refetch. Throws 400 with a precise field-pointing message on any
 * failure.
 */
@Injectable()
export class PublishValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validatePublishable(
    productId: string,
    tenantId: string,
  ): Promise<{
    product: Awaited<ReturnType<PublishValidationService['loadFull']>>;
    imageCount: number;
    activeVariantCount: number;
  }> {
    const product = await this.loadFull(productId, tenantId);

    if (!product) {
      throw new BadRequestException(
        `Product ${productId} not found in this tenant — cannot publish.`,
      );
    }
    if (product.deletedAt) {
      throw new BadRequestException(
        'Product is soft-deleted (in the recycle bin). Restore it before publishing.',
      );
    }
    if (product.isActive) {
      throw new BadRequestException(
        'Product is already active. Nothing to publish.',
      );
    }
    if (!product.name || !product.name.trim()) {
      throw new BadRequestException('Product is missing a name.');
    }
    if (!product.slug || !product.slug.trim()) {
      throw new BadRequestException('Product is missing a slug.');
    }
    if (!product.category) {
      throw new BadRequestException(
        'Product is not assigned to a category. Set one before publishing.',
      );
    }

    const imageCount = product.images?.length ?? 0;
    if (imageCount < 1) {
      throw new BadRequestException(
        'Product needs at least one image before it can be published.',
      );
    }

    const base = Number(product.basePrice ?? 0);
    if (!Number.isFinite(base) || base <= 0) {
      throw new BadRequestException(
        'Product basePrice must be greater than 0 before publishing.',
      );
    }

    const activeVariantCount = (product.variants ?? []).filter(
      (v: any) => v.isActive !== false,
    ).length;

    const mode = product.availabilityMode ?? 'PURCHASE_ONLY';
    if (mode === 'PURCHASE_ONLY' || mode === 'BOTH') {
      if (activeVariantCount < 1) {
        throw new BadRequestException(
          'Product with availabilityMode=' +
            mode +
            ' must have at least one active variant before publishing.',
        );
      }
    }
    if (mode === 'RENTAL_ONLY' || mode === 'BOTH') {
      const rental = Number(product.rentalPricePerDay ?? 0);
      if (!Number.isFinite(rental) || rental <= 0) {
        throw new BadRequestException(
          'Product with availabilityMode=' +
            mode +
            ' must have rentalPricePerDay > 0 before publishing.',
        );
      }
    }

    return { product, imageCount, activeVariantCount };
  }

  /**
   * Single read used by both the validator AND the approval-summary
   * resolver — keeps `expectedUpdatedAt` consistent with whatever values
   * the snapshot captured.
   */
  async loadFull(productId: string, tenantId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        images: { select: { id: true, url: true }, orderBy: { sortOrder: 'asc' } },
        variants: { select: { id: true, name: true, isActive: true, stock: true, price: true } },
      },
    });
  }
}
