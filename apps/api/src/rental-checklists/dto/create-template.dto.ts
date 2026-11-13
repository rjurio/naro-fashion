import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
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

  /** R3: how many must go out / come back (default 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  /** R3: a mandatory item blocks the hand-over until checked (default true). */
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  /** R3: staff record the item's condition (default true). */
  @IsOptional()
  @IsBoolean()
  requiresCondition?: boolean;

  /** R3: what to look at (shown at hand-over and return). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;
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

  /** R3: this list applies to one product (most specific)... */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  productId?: string | null;

  /** ...or to every product of one category. Neither = shop default candidate. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  categoryId?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items: TemplateItemDto[];
}
