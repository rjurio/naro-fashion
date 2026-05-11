import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * archive_product pre-flight validation — Phase 3.1B.
 *
 * Runs at request-approval time AND again at execute time as defence in
 * depth, mirroring the `PublishValidationService` shape. "Archive" here
 * means flip `isActive: false` — it does NOT touch `deletedAt` (that's
 * the recycle-bin / soft-delete path, separate operation). The product
 * stays in the admin surface so an operator can re-publish via a fresh
 * approval cycle later.
 *
 * Rules:
 *   - product exists in the caller's tenant
 *   - product NOT soft-deleted (`deletedAt = null`)
 *   - product currently active (archiving an already-inactive product is
 *     a no-op and would clobber the audit chain — refuse explicitly)
 *
 * Notice the inverted shape compared to `validatePublishable`: this
 * service rejects when `isActive === false`, the publish path rejects
 * when `isActive === true`. Together they enforce the state-machine
 * contract: only one of {publish, archive} is ever the right next move
 * for any given product at any given time.
 *
 * Returns the loaded product so callers don't refetch. Throws 400 with a
 * precise message on any failure.
 */
@Injectable()
export class ArchiveValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateArchivable(productId: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        deletedAt: true,
        basePrice: true,
        updatedAt: true,
      },
    });

    if (!product) {
      throw new BadRequestException(
        `Product ${productId} not found in this tenant — cannot archive.`,
      );
    }
    if (product.deletedAt) {
      throw new BadRequestException(
        'Product is soft-deleted (in the recycle bin). It is already hidden from customers; nothing to archive.',
      );
    }
    if (!product.isActive) {
      throw new BadRequestException(
        'Product is already inactive (archived). Nothing to archive.',
      );
    }

    return { product };
  }
}
