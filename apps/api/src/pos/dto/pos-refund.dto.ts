import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const RETURN_CONDITIONS = ['RESALEABLE', 'DAMAGED'] as const;

export class RefundItemDto {
  @IsString()
  orderItemId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  /** R1b: what the returned unit(s) are fit for; only RESALEABLE goes back into stock (at payout). */
  @IsOptional()
  @IsIn(RETURN_CONDITIONS as unknown as string[])
  condition?: (typeof RETURN_CONDITIONS)[number];
}

export class PosRefundDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundItemDto)
  items?: RefundItemDto[]; // If empty/missing, full refund

  @IsString()
  refundMethod: string; // CASH, MPESA, etc.

  /** Condition applied to every line when `items` is omitted (full refund). */
  @IsOptional()
  @IsIn(RETURN_CONDITIONS as unknown as string[])
  condition?: (typeof RETURN_CONDITIONS)[number];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
