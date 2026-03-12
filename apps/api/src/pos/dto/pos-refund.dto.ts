import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RefundItemDto {
  @IsString()
  orderItemId: string;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class PosRefundDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundItemDto)
  items?: RefundItemDto[]; // If empty/missing, full refund

  @IsString()
  refundMethod: string; // CASH, MPESA, etc.

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
