import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class HeldItemDto {
  @IsString()
  productId: string;

  @IsString()
  variantId: string;

  @IsString()
  productName: string;

  @IsString()
  variantName: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  itemDiscount?: number;
}

export class HoldSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeldItemDto)
  items: HeldItemDto[];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  discountType?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
