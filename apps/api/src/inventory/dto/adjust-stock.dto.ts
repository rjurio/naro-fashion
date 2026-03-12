import { IsString, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustStockDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsString()
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
}
