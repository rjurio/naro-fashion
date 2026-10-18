import { IsString, IsOptional, IsNumber, IsDateString, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateExpenseDto {
  /**
   * Optimistic concurrency (admin offline mode): the updatedAt the client
   * last saw. Mismatch → 409 CONFLICT with the current record. Omit = no check.
   */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
