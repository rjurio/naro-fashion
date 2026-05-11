import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * restore_product pre-flight validation — Phase 3.1B.β (2026-05-11).
 *
 * The third lifecycle verb after `publish_product` and `archive_product`.
 * Specifically un-does an `archive_product`: takes a row from ARCHIVED
 * back to ACTIVE. Mirror of `ArchiveValidationService` with the state
 * direction inverted, plus the extra `archivedAt: not null` discriminator
 * that distinguishes archived rows from drafts.
 *
 * Rules:
 *   - product exists in the caller's tenant
 *   - product NOT soft-deleted (`deletedAt: null`)
 *   - product currently INACTIVE (`isActive: false`)
 *   - product is an ARCHIVED row (`archivedAt: not null`). Drafts are
 *     explicitly rejected with "use publish_product instead" because
 *     drafts haven't been through a previous review cycle and the
 *     restore verb implies "bring back a previously-vetted product".
 *
 * The DRAFT-vs-ARCHIVED discriminator is the whole reason
 * `Product.archivedAt` was added in PR-α (commit 9f99dc1). Without it
 * this validator could not safely distinguish the two states.
 *
 * Returns the loaded product so callers don't refetch. Throws 400 with a
 * precise message on any failure.
 */
@Injectable()
export class RestoreValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateRestorable(productId: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        archivedAt: true,
        deletedAt: true,
        basePrice: true,
        updatedAt: true,
      },
    });

    if (!product) {
      throw new BadRequestException(
        `Product ${productId} not found in this tenant — cannot restore.`,
      );
    }
    if (product.deletedAt) {
      throw new BadRequestException(
        'Product is soft-deleted (in the recycle bin). Restore it from the recycle bin first, not via restore_product.',
      );
    }
    if (product.isActive) {
      throw new BadRequestException(
        'Product is already active. Nothing to restore.',
      );
    }
    if (!product.archivedAt) {
      // Inactive but never archived → it's a draft. The right verb is
      // publish_product, which runs the full publish-readiness checks
      // (name/slug/category/images/price/variants) that restore_product
      // intentionally skips because an archived row already passed them
      // once before.
      throw new BadRequestException(
        'This product is a draft, not an archived product. Use publish_product instead.',
      );
    }

    return { product };
  }
}
