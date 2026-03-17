import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Matches,
} from 'class-validator';

export enum GatewayPaymentMethod {
  MOBILE_MONEY = 'MOBILE_MONEY',
  CARD = 'CARD',
}

export class InitiatePaymentDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  rentalOrderId?: string;

  @IsNumber()
  @Min(100, { message: 'Minimum payment amount is 100 TZS' })
  amount: number;

  @IsEnum(GatewayPaymentMethod, {
    message: 'method must be MOBILE_MONEY or CARD',
  })
  method: GatewayPaymentMethod;

  @IsOptional()
  @IsString()
  @Matches(/^(\+?255|0)?[67]\d{8}$/, {
    message:
      'Phone number must be a valid Tanzanian mobile number (e.g., 0712345678, +255712345678)',
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  buyerEmail?: string;

  @IsOptional()
  @IsString()
  buyerName?: string;
}
