import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** One item as the approver physically verified it (round 25F D). */
export class ConfirmedTemplateItemDto {
  @IsString() @MaxLength(40) itemId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
}

export class ConfirmedScopeDto {
  @IsOptional() @IsString() @MaxLength(40) productId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) categoryId?: string | null;
}

/**
 * Approve the EXACT version the approver reviewed: version + content hash
 * (as shown by GET /rental-checklists/templates/:id), the scope, and every
 * item with its quantity.
 */
export class ApproveTemplateDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @Length(64, 64) @Matches(/^[0-9a-f]{64}$/) hash!: string;
  @ValidateNested() @Type(() => ConfirmedScopeDto) scope!: ConfirmedScopeDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConfirmedTemplateItemDto) confirmedItems!: ConfirmedTemplateItemDto[];
}

export class WithdrawTemplateDto {
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
