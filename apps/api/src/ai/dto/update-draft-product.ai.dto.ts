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
 * AI-agent draft-product UPDATE input — Phase 3.1B.γ (2026-05-11).
 *
 * Whitelist of editable fields on a DRAFT product. The global
 * ValidationPipe runs with `forbidNonWhitelisted: true`, so any field
 * NOT declared here returns 400 `property X should not exist` BEFORE
 * the handler runs. This is the wire-level gate.
 *
 * **FORBIDDEN at the wire** (omitted from this DTO → DTO whitelist
 * rejects them):
 *   basePrice, compareAtPrice, purchasePrice
 *   rentalPricePerDay, rentalDepositAmount, rentalDownPaymentPct
 *   latePenaltyPercent
 *   isActive, archivedAt, deletedAt, published, status
 *   isFeatured  (lifecycle-adjacent — covered separately)
 *   stock  (no inventory writes — Phase 4)
 *   any payment/order/rental field
 *
 * Defence-in-depth: even if a forbidden field somehow leaked past the
 * DTO, the execute path re-filters via an explicit allowlist in
 * `ApprovalService` so only the fields below can ever make it into
 * the Prisma update.
 *
 * Empty payloads are rejected at the service layer (`requestUpdate
 * DraftProduct`) with a precise "no changes detected" error. The DTO
 * itself doesn't enforce "at least one field" because class-validator
 * doesn't compose with `IsOptional` cleanly for that case — the
 * service-layer check is cleaner.
 */
export class UpdateDraftProductAiDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string;

  @IsOptional()
  @IsIn(['PURCHASE_ONLY', 'RENTAL_ONLY', 'BOTH'])
  availabilityMode?: 'PURCHASE_ONLY' | 'RENTAL_ONLY' | 'BOTH';

  /**
   * Free-form structured spec block. Prisma column is `Json?` so we
   * accept any JSON-shaped value (object, array, or null). The
   * sanitiser caps the audit-log payload at 64KB so an exotic
   * structure can't bloat storage; the sanitiser also enforces a
   * max nesting depth.
   *
   * Typed as `any` deliberately — a union-type design here emits TS
   * metadata that class-transformer's `@Type` decorator on later
   * fields can't parse, breaking the whole DTO at module-load time.
   */
  @IsOptional()
  specifications?: any;

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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sizeGuideId?: string;
}

/**
 * The single source of truth for which fields the execute path is
 * allowed to write. Defence-in-depth — even if the DTO somehow let an
 * unexpected key through, the consume transaction picks values by
 * iterating THIS list and ignoring everything else on the row's
 * sanitised inputJson.
 */
export const UPDATE_DRAFT_ALLOWED_FIELDS = [
  'name',
  'nameSwahili',
  'slug',
  'description',
  'descriptionSwahili',
  'categoryId',
  'availabilityMode',
  'specifications',
  'sku',
  'minimumStock',
  'supplierName',
  'supplierContact',
  'minRentalDays',
  'maxRentalDays',
  'bufferDaysOverride',
  'sizeGuideId',
] as const;

export type UpdateDraftAllowedField =
  (typeof UPDATE_DRAFT_ALLOWED_FIELDS)[number];
