import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * AI-agent input for creating a ProductSize.
 *
 * Sizes are admin-only entities (used in ProductVariant.size); they don't
 * render on the storefront until an admin builds a variant with that label.
 * That makes live creation safe — no approval needed.
 *
 * BLOCKED fields (forbidNonWhitelisted will 400):
 *   isActive — defaults to active server-side; flipping it is a future
 *   AI tool gated by approval.
 */
export class CreateSizeAiDto {
  @IsString()
  @MaxLength(20)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}
