import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Whitelisted body for POST /reports/financials/periods. Previously the
 * controller took `any` and the service spread it into prisma.create — a
 * caller could set status:'CLOSED', closedBy, tenantId, etc. directly.
 * Status always starts OPEN; closing goes through the close endpoint.
 */
export class CreateFinancialPeriodDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'periodKey must be YYYY-MM' })
  periodKey: string;

  @IsString()
  @MaxLength(100)
  periodName: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(['MONTH'])
  periodType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
