import { IsOptional, IsString, IsInt, Min, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export const ORDER_SORTS = ['newest', 'oldest'] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

/** createdAt ordering for an order list; newest first unless asked otherwise. */
export function orderSortToOrderBy(sort?: OrderSort): { createdAt: 'asc' | 'desc' } {
  return { createdAt: sort === 'oldest' ? 'asc' : 'desc' };
}

export class QueryOrdersDto {
  @IsOptional()
  @IsString()
  status?: string;

  // The storefront sends sort=newest. Before this field existed the strict
  // whitelist (forbidNonWhitelisted) rejected it with 400, and customer order
  // history silently showed "No orders yet".
  @IsOptional()
  @IsIn(ORDER_SORTS)
  sort?: OrderSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class AdminQueryOrdersDto extends QueryOrdersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
