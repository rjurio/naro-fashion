import { IsNumber, IsOptional, Min } from 'class-validator';

export class OpenSessionDto {
  @IsNumber()
  @Min(0)
  openingCash: number;

  @IsOptional()
  @IsNumber()
  notes?: string;
}
