import { IsOptional, IsNumber, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateInventorySettingsDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  purchasePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minimumStock?: number;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsString()
  supplierContact?: string;
}
