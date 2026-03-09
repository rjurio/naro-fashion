import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';

export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  @IsIn(['PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  @IsOptional()
  @IsDateString()
  estimatedDelivery?: string;

  @IsOptional()
  @IsDateString()
  shippedAt?: string;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string;
}
