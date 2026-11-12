import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';

/** Staff extend an unconfirmed booking's deadline (rentals:update-status). */
export class ExtendRentalHoldDto {
  /** New deadline (ISO). Must be in the future, within 7 days, and not after the end of the pickup day. */
  @IsDateString()
  until!: string;

  /** Why (audited). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}

export const RENTAL_REFUND_METHODS = ['MOBILE_MONEY', 'BANK_TRANSFER', 'CASH'] as const;

/**
 * Finance staff record that the money held on a cancelled booking was paid
 * back (payments:manage). Records the payout in the audit log and closes the
 * REFUND_DUE flag; it does not create a Payment row (proposal: a rental
 * refund ledger with P0c).
 */
export class RecordRentalRefundDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000)
  amount!: number;

  @IsIn(RENTAL_REFUND_METHODS as unknown as string[])
  method!: (typeof RENTAL_REFUND_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
