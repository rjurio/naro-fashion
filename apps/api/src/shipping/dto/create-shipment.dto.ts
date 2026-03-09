import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateShipmentDto {
  @IsString()
  orderId: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;

  @IsOptional()
  @IsString()
  shippingZoneId?: string;

  @IsOptional()
  @IsDateString()
  estimatedDelivery?: string;
}
