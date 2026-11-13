import { IsString, IsInt, IsOptional, IsPositive, IsIn, MaxLength, Min } from 'class-validator';
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
}
