import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { HeldItemDto } from './hold-sale.dto';

export class CreateLayawayDto {
  @IsString()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeldItemDto)
  items: HeldItemDto[];

  @IsNumber()
  @Min(0)
  depositAmount: number;

  @IsString()
  depositMethod: string; // CASH, MPESA, etc.

  @IsOptional()
  @IsString()
  depositTransactionRef?: string;

  @IsString()
  dueDate: string; // ISO date string

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

export class LayawayPaymentDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  method: string;

  @IsOptional()
  @IsString()
  transactionRef?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
