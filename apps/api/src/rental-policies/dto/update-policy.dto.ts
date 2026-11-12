import { IsOptional, IsInt, IsNumber, Min } from 'class-validator';

export class UpdatePolicyDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferDaysBetweenRentals?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultDownPaymentPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeePerDay?: number;

  /** LF-2026-11: shop default late fee, % of the rental fee per late day (0–100). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultLateFeePct?: number;

  /** LF-2026-11: maximum accumulated late fee, % of the rental fee (0–100). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeeCapPct?: number;

  /** LF-2026-11: explicit daily late fee for FREE rentals (none when unset). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeRentalLateFeePerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRentalDurationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  advancePreparationReminderDays?: number;
}
