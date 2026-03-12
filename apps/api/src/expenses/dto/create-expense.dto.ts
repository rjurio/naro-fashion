import { IsString, IsOptional, IsNumber, IsDateString, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  @IsString()
  categoryId: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsDateString()
  expenseDate: string;

  @IsOptional()
  @IsString()
  receiptUrl?: string;
}
