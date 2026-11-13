import { IsString, IsInt, IsOptional, IsPositive, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustStockDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  // Security fix: only the three manual movement types (SALE / RENTAL_OUT /
  // RETURN belong to their own flows and were accepted here before).
  @IsIn(['RESTOCK', 'ADJUSTMENT', 'DAMAGE'])
  type: string; // RESTOCK|ADJUSTMENT|DAMAGE

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  quantity: number; // always positive; sign determined by type

  @IsOptional()
  @IsString()
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
