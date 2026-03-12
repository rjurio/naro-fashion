import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
