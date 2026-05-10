import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * AI-agent draft size-guide input. The underlying service forces
 * `isActive: false` and `isDefault: false` regardless of input.
 *
 * BLOCKED fields (forbidNonWhitelisted will 400):
 *   isActive, isDefault — drafts can never be live or default-for-tenant.
 *   slug — auto-generated server-side from `name`.
 */
export class CreateSizeGuideAiDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameSwahili?: string;

  @IsString()
  @MaxLength(20000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  contentSwahili?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pdfUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pdfUrlSwahili?: string;
}
