// reflect-metadata must be loaded before class-transformer touches any
// decorator on the DTO. The sibling create-product-draft.ai.dto.spec.ts
// imports it transitively via @nestjs/common (ValidationPipe); we
// import it directly to keep this spec NestJS-free.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UPDATE_DRAFT_ALLOWED_FIELDS,
  UpdateDraftProductAiDto,
} from './update-draft-product.ai.dto';

/**
 * Wire-level DTO whitelist tests for update_draft_product. The global
 * ValidationPipe in main.ts is configured with `forbidNonWhitelisted:
 * true`, so any field absent from this DTO causes a 400 at request
 * time with `property X should not exist`. These tests pin that
 * behaviour at the DTO level so a future refactor can't accidentally
 * widen the surface.
 *
 * NestJS's ValidationPipe handles the `forbidNonWhitelisted` rejection
 * separately from class-validator (it's a transformation step), so we
 * test it via the same `validate` + `whitelist` shape rather than
 * booting the pipe.
 */
describe('UpdateDraftProductAiDto — wire-level whitelist', () => {
  function toDto(raw: unknown): UpdateDraftProductAiDto {
    return plainToInstance(UpdateDraftProductAiDto, raw, {
      enableImplicitConversion: false,
    });
  }

  // ─── Forbidden fields (pricing) ────────────────────────────────
  const FORBIDDEN_PRICING_FIELDS = [
    'basePrice',
    'compareAtPrice',
    'purchasePrice',
    'rentalPricePerDay',
    'rentalDepositAmount',
    'rentalDownPaymentPct',
    'latePenaltyPercent',
  ];

  // ─── Forbidden fields (lifecycle) ──────────────────────────────
  const FORBIDDEN_LIFECYCLE_FIELDS = [
    'isActive',
    'archivedAt',
    'deletedAt',
    'published',
    'status',
    'isFeatured',
  ];

  // ─── Forbidden fields (inventory/payment/order) ───────────────
  const FORBIDDEN_OTHER_FIELDS = [
    'stock',
    'paymentMethodId',
    'orderStatus',
    'rentalStatus',
    'transactionRef',
  ];

  it.each([
    ...FORBIDDEN_PRICING_FIELDS,
    ...FORBIDDEN_LIFECYCLE_FIELDS,
    ...FORBIDDEN_OTHER_FIELDS,
  ])(
    'forbidden field %s is NOT declared on the DTO — global ValidationPipe will reject it as `should not exist`',
    (field) => {
      // The DTO is the source of truth for which fields the wire
      // accepts. If a future PR adds a property with one of these
      // names, this test catches it instantly.
      expect(UPDATE_DRAFT_ALLOWED_FIELDS).not.toContain(field as any);
      const dto = new UpdateDraftProductAiDto();
      expect(field in dto).toBe(false);
    },
  );

  it('UPDATE_DRAFT_ALLOWED_FIELDS exactly matches the documented allowlist', () => {
    // Source-of-truth assertion. If a future PR adds a field to the
    // DTO without also updating UPDATE_DRAFT_ALLOWED_FIELDS (or vice
    // versa), the consume path's defence-in-depth filter would drift
    // from the DTO whitelist. This test catches the drift.
    expect([...UPDATE_DRAFT_ALLOWED_FIELDS].sort()).toEqual(
      [
        'availabilityMode',
        'bufferDaysOverride',
        'categoryId',
        'description',
        'descriptionSwahili',
        'maxRentalDays',
        'minRentalDays',
        'minimumStock',
        'name',
        'nameSwahili',
        'sizeGuideId',
        'sku',
        'slug',
        'specifications',
        'supplierContact',
        'supplierName',
      ].sort(),
    );
  });

  // ─── Allowed fields (semantic validation) ──────────────────────
  it('accepts a minimal allowed payload (just name)', async () => {
    const dto = toDto({ name: 'New name' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
  });

  it('rejects name > 200 chars', async () => {
    const dto = toDto({ name: 'a'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'name')).toBeDefined();
  });

  it('rejects availabilityMode not in {PURCHASE_ONLY, RENTAL_ONLY, BOTH}', async () => {
    const dto = toDto({ availabilityMode: 'WHATEVER' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'availabilityMode')).toBeDefined();
  });

  it('accepts availabilityMode = BOTH', async () => {
    const dto = toDto({ availabilityMode: 'BOTH' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts specifications as an object (Prisma Json column, no shape enforcement)', async () => {
    const dto = toDto({ specifications: { color: 'red', material: 'silk' } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts specifications as an array (storefront reads as features list)', async () => {
    const dto = toDto({ specifications: ['silk', 'lined', 'hand-wash'] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts specifications: null (clear the field)', async () => {
    const dto = toDto({ specifications: null });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects negative minimumStock', async () => {
    const dto = toDto({ minimumStock: -5 });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'minimumStock')).toBeDefined();
  });

  it('rejects non-integer minRentalDays', async () => {
    const dto = toDto({ minRentalDays: 'foo' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'minRentalDays')).toBeDefined();
  });

  // ─── Sanity: full happy-path payload validates cleanly ─────────
  it('accepts a comprehensive valid payload across all allowed fields', async () => {
    const dto = toDto({
      name: 'New name',
      nameSwahili: 'Jina jipya',
      slug: 'new-slug',
      description: 'Updated description.',
      descriptionSwahili: 'Maelezo yameboreshwa.',
      categoryId: 'cat_123',
      availabilityMode: 'PURCHASE_ONLY',
      specifications: { material: 'silk' },
      sku: 'SKU-XYZ',
      minimumStock: 3,
      supplierName: 'Acme',
      supplierContact: 'acme@example.com',
      minRentalDays: 1,
      maxRentalDays: 7,
      bufferDaysOverride: 2,
      sizeGuideId: 'sg_abc',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
