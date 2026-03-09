import { IsString, IsDateString, IsOptional } from 'class-validator';

export class CreateRentalDto {
  @IsString()
  productId: string;

  @IsString()
  variantId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  returnDate: string;

  @IsDateString()
  pickupDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
