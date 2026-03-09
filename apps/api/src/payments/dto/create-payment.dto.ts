import { IsString, IsOptional, IsNumber, IsEnum, Min } from 'class-validator';

export enum PaymentMethodEnum {
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  CARD = 'CARD',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export class CreatePaymentDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  rentalOrderId?: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsEnum(PaymentMethodEnum)
  method: PaymentMethodEnum;

  @IsOptional()
  @IsString()
  transactionRef?: string;
}

export class UpdatePaymentDto {
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsOptional()
  gatewayResponse?: any;
}
