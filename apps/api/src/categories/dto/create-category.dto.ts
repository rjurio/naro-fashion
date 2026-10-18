import { IsString, IsOptional, IsInt, MaxLength, Min, ValidateIf, Matches } from 'class-validator';
import { CLIENT_ID_REGEX } from '../../common/offline-sync.util';

export class CreateCategoryDto {
  /**
   * Optional client-generated id (admin offline mode). Lets an offline
   * device create a record and keep editing it before sync without id
   * mapping. Collision with any existing row → 409 ID_CONFLICT.
   */
  @IsOptional()
  @IsString()
  @Matches(CLIENT_ID_REGEX, { message: 'id must match ^[a-z0-9][a-z0-9_-]{19,40}$' })
  id?: string;

  /** Display name. `nameEn` (legacy admin form key) is accepted as an alias. */
  @ValidateIf((o) => o.nameEn === undefined)
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
