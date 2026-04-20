import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';

export enum PaymentMethod {
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH_ON_DELIVERY = 'CASH_ON_DELIVERY',
  CARD = 'CARD',
}

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  addressId?: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;
}
