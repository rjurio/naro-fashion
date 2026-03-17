import { IsString, IsDateString, IsOptional, IsIn } from 'class-validator';

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
  pickupTime?: string;

  @IsOptional()
  @IsDateString()
  weddingDate?: string;

  @IsOptional()
  @IsString()
  weddingLocation?: string;

  @IsOptional()
  @IsString()
  weddingRegion?: string;

  @IsOptional()
  @IsIn(['HAND_PICKED', 'SHIPPED'])
  deliveryModality?: string;

  @IsOptional()
  @IsDateString()
  shippingDate?: string;

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsIn(['AIR', 'BUS', 'TRAIN', 'COURIER', 'OTHER'])
  transportMode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
