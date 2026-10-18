import { IsString, IsOptional, IsNumber, IsDateString, IsPositive, Matches } from 'class-validator';
import { CLIENT_ID_REGEX } from '../../common/offline-sync.util';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
  /**
   * Optional client-generated id (admin offline mode). Lets an offline
   * device create a record and keep editing it before sync without id
   * mapping. Collision with any existing row → 409 ID_CONFLICT.
   */
  @IsOptional()
  @IsString()
  @Matches(CLIENT_ID_REGEX, { message: 'id must match ^[a-z0-9][a-z0-9_-]{19,40}$' })
  id?: string;

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
