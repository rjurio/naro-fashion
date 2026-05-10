import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { CreateProductDraftAiDto } from './create-product-draft.ai.dto';

/**
 * Phase 2 contract: pricing fields MUST be impossible to set via the AI agent.
 *
 * The global ValidationPipe in production runs with
 *   { whitelist: true, forbidNonWhitelisted: true, transform: true }
 * so any field not declared on a DTO returns 400 `property X should not exist`
 * before the handler runs. This test instantiates the same pipe and confirms
 * each forbidden field would be rejected.
 *
 * If a future PR adds `basePrice` (or any pricing field) to this DTO, the
 * matching test below flips from "rejected → 400" to "accepted → no throw"
 * and the build fails — surfacing the violation immediately.
 */

describe('CreateProductDraftAiDto — pricing block invariant', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const minimalValid = {
    name: 'Test Gown',
    categoryId: 'cm_test_cat',
    availabilityMode: 'PURCHASE_ONLY',
  };

  async function transform(value: any): Promise<any> {
    return pipe.transform(value, {
      type: 'body',
      metatype: CreateProductDraftAiDto,
    });
  }

  it('accepts the minimal valid draft', async () => {
    const out = await transform(minimalValid);
    expect(out.name).toBe('Test Gown');
    expect(out.categoryId).toBe('cm_test_cat');
    expect(out.availabilityMode).toBe('PURCHASE_ONLY');
  });

  it('accepts optional non-pricing fields', async () => {
    const out = await transform({
      ...minimalValid,
      nameSwahili: 'Gauni la Mtihani',
      description: 'A test gown',
      sku: 'TEST-1',
      minimumStock: 3,
      supplierName: 'ACME',
      minRentalDays: 1,
      maxRentalDays: 7,
      bufferDaysOverride: 2,
    });
    expect(out.minRentalDays).toBe(1);
    expect(out.maxRentalDays).toBe(7);
  });

  // Each pricing field — and adjacent forbidden fields — must trigger the
  // whitelist rejection. We assert error message contains the field name.
  const forbiddenFields = [
    // direct pricing
    ['basePrice', 100000],
    ['compareAtPrice', 120000],
    ['purchasePrice', 50000],
    // rental pricing
    ['rentalPricePerDay', 25000],
    ['rentalDepositAmount', 100000],
    ['rentalDownPaymentPct', 30],
    ['latePenaltyPercent', 15],
    // visibility / publish state
    ['isActive', true],
    ['isFeatured', true],
    ['published', true],
    // resource references not allowed yet
    ['sizeGuideId', 'cm_guide_1'],
    ['model3dUrl', '/uploads/models/x.glb'],
    ['model3dPosterUrl', '/uploads/models/x.jpg'],
    // computed / system fields
    ['lastRestockedAt', '2026-05-10T00:00:00Z'],
    ['avgRating', 4.5],
    ['reviewCount', 10],
    ['deletedAt', null],
    // legacy / unknown
    ['price', 100000],
    ['somethingMadeUp', 'x'],
  ] as const;

  it.each(forbiddenFields)(
    'rejects forbidden field %s',
    async (field, value) => {
      let err: any;
      try {
        await transform({ ...minimalValid, [field]: value });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse() as any;
      const messages = Array.isArray(body?.message)
        ? body.message
        : [String(body?.message ?? '')];
      const allMessages = messages.join(' | ');
      expect(allMessages).toContain(`property ${field} should not exist`);
    },
  );

  it('rejects required fields when missing', async () => {
    let err: any;
    try {
      await transform({ name: 'Only name' }); // missing categoryId, availabilityMode
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid availabilityMode values', async () => {
    let err: any;
    try {
      await transform({ ...minimalValid, availabilityMode: 'INVALID' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
