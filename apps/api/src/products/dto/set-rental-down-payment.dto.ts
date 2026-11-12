import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/**
 * PATCH /products/:id/rental-down-payment. The ONLY way to change a product's
 * down-payment setting: ordinary product create/update DTOs don't accept these
 * fields (forbidNonWhitelisted), so a normal product save can never alter it.
 *
 * `expectedMode` / `expectedPct` are what the admin saw (compare-and-swap):
 * if the setting changed meanwhile the request is refused with 409.
 */
export class SetRentalDownPaymentDto {
  @IsIn(['INHERIT', 'CUSTOM'])
  mode!: 'INHERIT' | 'CUSTOM';

  /** Required for CUSTOM (whole percent, 0-100; 0 = no down payment). Not allowed with INHERIT. */
  @ValidateIf((o) => o.mode === 'CUSTOM' || o.pct !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  pct?: number;

  /** The setting the admin saw: INHERIT, CUSTOM, or NOT_REVIEWED (rows from before Nov 2026). */
  @IsIn(['INHERIT', 'CUSTOM', 'NOT_REVIEWED'])
  expectedMode!: 'INHERIT' | 'CUSTOM' | 'NOT_REVIEWED';

  /** The stored percentage the admin saw (null when none). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  expectedPct?: number | null;
}
