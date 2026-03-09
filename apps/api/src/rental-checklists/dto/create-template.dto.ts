import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsInt,
  IsIn,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateItemDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  labelSwahili?: string;

  @IsString()
  @IsIn(['DISPATCH', 'RETURN'])
  itemType: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items: TemplateItemDto[];
}
