import { IsString, IsDateString, IsOptional, IsIn } from 'class-validator';

export class UpdateRentalDto {
  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @IsOptional()
  @IsString()
  pickupTime?: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

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
  transportReceiptUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
