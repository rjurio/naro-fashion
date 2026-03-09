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

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRentalDurationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  advancePreparationReminderDays?: number;
}
