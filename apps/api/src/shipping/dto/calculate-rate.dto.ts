import { IsString, IsNumber, Min } from 'class-validator';

export class CalculateRateDto {
  @IsString()
  zoneId: string;

  @IsNumber()
  @Min(0)
  orderAmount: number;
}
