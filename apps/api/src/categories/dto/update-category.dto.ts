import { IsString, IsOptional, IsInt, MaxLength, Min } from 'class-validator';

export class UpdateCategoryDto {
  /** Display name. `nameEn` (legacy admin form key) is accepted as an alias. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  /** Swahili name. `nameSw` (legacy admin form key) is accepted as an alias. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameSwahili?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameSw?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  /** Image URL. Column is `imageUrl`; legacy `image` key accepted. */
  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsOptional()
  @IsString()
  image?: string | null;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  sizeGuideId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
