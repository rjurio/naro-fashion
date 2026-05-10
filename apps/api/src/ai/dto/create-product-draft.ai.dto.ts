import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * AI-agent draft-product input.
 *
 * The DTO whitelist (`forbidNonWhitelisted: true` on the global ValidationPipe)
 * means any field NOT declared here returns 400 `property X should not exist`
 * before the handler runs. This is how Phase 2 enforces "no pricing in AI write
 * tools": pricing fields are intentionally absent.
 *
 * BLOCKED fields (will 400 if sent):
 *   basePrice, compareAtPrice, purchasePrice
 *   rentalPricePerDay, rentalDepositAmount, rentalDownPaymentPct,
 *   latePenaltyPercent
 *   isActive, isFeatured  (drafts are forced inactive server-side)
 *   model3dUrl, model3dPosterUrl  (file uploads — go through /upload)
 *   sizeGuideId, lastRestockedAt
 *
 * Pricing changes land in Phase 3 alongside the approval workflow.
 */
export class CreateProductDraftAiDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameSwahili?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionSwahili?: string;

  @IsString()
  @MaxLength(40)
  categoryId: string;

  @IsIn(['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH'])
  availabilityMode: 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minimumStock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierContact?: string;

  // Rental window (no pricing — that's Phase 3)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minRentalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  maxRentalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  bufferDaysOverride?: number;
}
