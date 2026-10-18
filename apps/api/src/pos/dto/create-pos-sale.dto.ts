import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosItemDto {
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  itemDiscount?: number;
}

export class PosPaymentDto {
  @IsString()
  method: string; // CASH, MPESA, TIGO_PESA, AIRTEL_MONEY, MIX_BY_YAS, CARD, MOBILE_MONEY

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  transactionRef?: string;
}

export class CreatePosSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosItemDto)
  items: PosItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments: PosPaymentDto[];

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
  discountType?: string; // PERCENTAGE, FIXED

  @IsOptional()
  @IsString()
  note?: string;

  // ---- Admin offline mode -------------------------------------------------

  /**
   * True when the sale was rung up on a device without internet and is being
   * replayed after reconnect. Offline sales: only CASH or manual mobile-money
   * with a transactionRef; never rejected for short stock (stock clamped at 0,
   * order flagged `oversold`); order createdAt = clientCreatedAt.
   */
  @IsOptional()
  @IsBoolean()
  offline?: boolean;

  /** Real sale time on the device (ISO). ≤ 5 min in the future, ≤ 30 days old. */
  @IsOptional()
  @IsDateString()
  clientCreatedAt?: string;

  /** The POS shift that was open on the device when the sale was made. */
  @IsOptional()
  @IsString()
  sessionId?: string;
}
