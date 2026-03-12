import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class CreateExpenseCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryType?: string; // COGS|OPERATING|TAX|OTHER

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
