import { IsString, IsDateString, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator';

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

  // The amounts the customer was shown (GET /rentals/quote). Optional; when
  // sent, the booking is refused with 409 RENTAL_TERMS_CHANGED if the terms
  // it would store differ. Never used AS the stored amount.
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  quotedRentalFee?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  quotedDeposit?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  quotedDownPayment?: number;
}
