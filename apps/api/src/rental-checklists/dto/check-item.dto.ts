import { IsOptional, IsString } from 'class-validator';

export class CheckItemDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
