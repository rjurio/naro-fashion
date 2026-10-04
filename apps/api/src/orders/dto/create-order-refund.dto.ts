import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

export const ORDER_REFUND_METHODS = ['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH', 'GATEWAY'] as const;
export type OrderRefundMethod = (typeof ORDER_REFUND_METHODS)[number];

/** Body of POST /orders/:id/refunds (admin, `orders:refund`). */
export class CreateOrderRefundDto {
  /** Amount to refund in TZS (positive, ≤ collected − already refunded). */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000)
  amount!: number;

  /**
   * How the money goes back. MOBILE_MONEY / BANK_TRANSFER / CASH record a
   * refund made outside the gateway; GATEWAY asks the order's payment
   * provider to reverse the collection (400 when the provider can't).
   */
  @IsIn(ORDER_REFUND_METHODS as unknown as string[])
  method!: OrderRefundMethod;

  /** External reference (M-Pesa receipt, bank ref…). Unique per tenant. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
