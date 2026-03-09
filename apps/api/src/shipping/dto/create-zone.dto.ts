import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateShippingRateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  isFreeAbove?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateZoneDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  regions: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateShippingRateDto)
  rates?: CreateShippingRateDto[];
}
