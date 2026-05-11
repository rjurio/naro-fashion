import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UPDATE_DRAFT_ALLOWED_FIELDS,
  UpdateDraftAllowedField,
  UpdateDraftProductAiDto,
} from '../dto/update-draft-product.ai.dto';

const VALID_AVAILABILITY_MODES = new Set([
  'PURCHASE_ONLY',
  'RENTAL_ONLY',
  'BOTH',
]);

/**
 * update_draft_product pre-flight validation — Phase 3.1B.γ.
 *
 * Two-layer guarantee for the FIRST AI tool that accepts a payload
 * beyond just an id:
 *   1. **Lifecycle gate** — only DRAFT products may be updated via the
 *      AI agent. ACTIVE / ARCHIVED / SOFT_DELETED rejected. Cross-tenant
 *      rejected (the findFirst is tenant-scoped).
 *   2. **Payload gate** — each provided field is validated against the
 *      business rules (slug uniqueness, category existence,
 *      sizeGuideId existence, availabilityMode whitelist). Forbidden
 *      fields (pricing/lifecycle) are already stripped by the DTO
 *      whitelist; here we additionally re-filter via the allow-list
 *      `UPDATE_DRAFT_ALLOWED_FIELDS` as defence in depth.
 *
 * Returns the loaded product + the computed change-set so callers
 * don't refetch. Throws 400 with a precise message on any failure.
 *
 * The same validator runs at request-approval AND execute time
 * (re-validation post-approval), so any drift between request and
 * execute (e.g. the product was archived between approve and execute)
 * is rejected at consume time before the write.
 */
@Injectable()
export class UpdateDraftValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async validateUpdateDraft(
    productId: string,
    dto: UpdateDraftProductAiDto,
    tenantId: string,
  ): Promise<{
    product: any;
    /** Fields that actually differ from the current product values. */
    changedFields: Partial<Record<UpdateDraftAllowedField, unknown>>;
    /** Snapshot of the current values for the changed fields only. */
    beforeValues: Partial<Record<UpdateDraftAllowedField, unknown>>;
  }> {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException(
        'Update payload is empty. Provide at least one allowed field to change.',
      );
    }

    // Reject any unknown/forbidden field that survived the DTO. The
    // global ValidationPipe with `forbidNonWhitelisted: true` already
    // catches this at the wire, but the validator is called again at
    // execute time on the row's stored `inputJson` (which could in
    // theory have been edited in the DB), so we belt-and-braces here.
    const allowedSet = new Set<string>(UPDATE_DRAFT_ALLOWED_FIELDS);
    for (const key of Object.keys(dto)) {
      if (!allowedSet.has(key)) {
        throw new BadRequestException(
          `Field "${key}" is not allowed in update_draft_product. Allowed: ${UPDATE_DRAFT_ALLOWED_FIELDS.join(', ')}.`,
        );
      }
    }

    // Load the row. Tenant-scoped — cross-tenant returns null → 400
    // "not found in this tenant" (mirror of the other validators).
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        nameSwahili: true,
        slug: true,
        description: true,
        descriptionSwahili: true,
        categoryId: true,
        availabilityMode: true,
        specifications: true,
        sku: true,
        minimumStock: true,
        supplierName: true,
        supplierContact: true,
        minRentalDays: true,
        maxRentalDays: true,
        bufferDaysOverride: true,
        sizeGuideId: true,
        isActive: true,
        archivedAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });

    if (!product) {
      throw new BadRequestException(
        `Product ${productId} not found in this tenant — cannot update.`,
      );
    }

    // ─── Lifecycle gate ───────────────────────────────────────────
    if (product.deletedAt) {
      throw new BadRequestException(
        'Product is soft-deleted (in the recycle bin). Restore it first.',
      );
    }
    if (product.isActive) {
      throw new BadRequestException(
        'Product is ACTIVE. update_draft_product only edits DRAFT products. Archive it first if you need to update.',
      );
    }
    if (product.archivedAt) {
      throw new BadRequestException(
        'Product is ARCHIVED, not a draft. update_draft_product only edits DRAFT products. Restore it first via restore_product.',
      );
    }

    // ─── Per-field business validation ───────────────────────────
    if (dto.availabilityMode !== undefined) {
      if (!VALID_AVAILABILITY_MODES.has(dto.availabilityMode)) {
        throw new BadRequestException(
          `availabilityMode must be one of PURCHASE_ONLY, RENTAL_ONLY, BOTH (got "${dto.availabilityMode}").`,
        );
      }
    }

    if (dto.categoryId !== undefined) {
      const cat = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, tenantId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException(
          `categoryId "${dto.categoryId}" not found in this tenant.`,
        );
      }
    }

    if (dto.sizeGuideId !== undefined) {
      const guide = await this.prisma.sizeGuide.findFirst({
        where: { id: dto.sizeGuideId, tenantId },
        select: { id: true },
      });
      if (!guide) {
        throw new BadRequestException(
          `sizeGuideId "${dto.sizeGuideId}" not found in this tenant.`,
        );
      }
    }

    if (dto.slug !== undefined && dto.slug !== product.slug) {
      // Slug uniqueness within the tenant — composite uniqueness on
      // Product table is (tenantId, slug). Exclude this product's own
      // row from the conflict check.
      const dup = await this.prisma.product.findFirst({
        where: { tenantId, slug: dto.slug, NOT: { id: productId } },
        select: { id: true },
      });
      if (dup) {
        throw new BadRequestException(
          `slug "${dto.slug}" is already in use by another product in this tenant.`,
        );
      }
    }

    if (dto.minRentalDays !== undefined && dto.maxRentalDays !== undefined) {
      if (dto.minRentalDays > dto.maxRentalDays) {
        throw new BadRequestException(
          'minRentalDays cannot be greater than maxRentalDays.',
        );
      }
    }

    // ─── Compute diff ────────────────────────────────────────────
    // Only fields the operator actually wants to CHANGE land in the
    // approval row's beforeValues/afterValues. If everything matches
    // the current values, we reject — there's nothing to do.
    const changedFields: Partial<Record<UpdateDraftAllowedField, unknown>> = {};
    const beforeValues: Partial<Record<UpdateDraftAllowedField, unknown>> = {};
    for (const field of UPDATE_DRAFT_ALLOWED_FIELDS) {
      if (!(field in dto)) continue;
      const next = (dto as any)[field];
      const current = (product as any)[field];
      if (!shallowEqual(next, current)) {
        changedFields[field] = next;
        beforeValues[field] = current;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      throw new BadRequestException(
        'No changes detected — every submitted field already matches the current product value.',
      );
    }

    return { product, changedFields, beforeValues };
  }
}

/**
 * Order-insensitive equality for plain JSON-shaped values. Compares:
 *   - primitives via ===
 *   - Date objects via .getTime()
 *   - arrays element-wise (recursively)
 *   - objects key-wise (recursively)
 *
 * Used to decide whether a submitted field actually represents a
 * change from the current value. NOT a generic deep-equal — we don't
 * need to handle Maps, Sets, Symbols, circular refs etc. because the
 * inputs are all Prisma column values + DTO payload.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!shallowEqual((a as any)[ka[i]], (b as any)[kb[i]])) return false;
  }
  return true;
}
