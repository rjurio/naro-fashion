import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ExchangeReturnItemDto {
  @IsString()
  orderItemId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class ExchangeNewItemDto {
  @IsString()
  productId: string;

  @IsString()
  variantId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateExchangeDto {
  @IsString()
  originalOrderId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExchangeReturnItemDto)
  returnedItems: ExchangeReturnItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExchangeNewItemDto)
  newItems: ExchangeNewItemDto[];

  @IsOptional()
  @IsString()
  settlementMethod?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
