import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  productId: string;

  @IsString()
  variantId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number = 1;

  @IsOptional()
  @IsString()
  notes?: string;
}
