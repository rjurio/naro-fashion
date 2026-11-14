import { IsString, IsInt, IsOptional, IsPositive, IsIn, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export const ADJUST_STOCK_TYPES = ['RESTOCK', 'ADJUSTMENT', 'DAMAGE'];

export class AdjustStockDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  /**
   * Only the three manual types the admin Inventory page offers. SALE /
   * RENTAL_OUT rows are written by the sale code itself, never by hand.
   * Only RESTOCK can make a sold buy-or-rent gown rentable again.
   */
  @IsIn(ADJUST_STOCK_TYPES)
  type: string;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  quantity: number; // always positive; sign determined by type

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  /** Optional: the stock the caller saw. If it changed meanwhile → 409 STALE_STOCK, nothing written. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  expectedStock?: number;

  /**
   * Round 25F E: an ADJUSTMENT may correct stock DOWN (counted fewer than
   * recorded). DAMAGE is always a decrease, RESTOCK always an increase.
   */
  @IsOptional()
  @IsIn(['INCREASE', 'DECREASE'])
  direction?: 'INCREASE' | 'DECREASE';
}

export class DecideAdjustmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApprovalThresholdsDto {
  /** Units: a decrease of at most this many units is one-step (null = not set). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  maxUnits?: number | null;

  /** % of the stock before (0–100): one-step only within it (null = not set). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  maxPct?: number | null;
}
