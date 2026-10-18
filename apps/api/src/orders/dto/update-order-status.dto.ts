import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  /**
   * Optimistic concurrency (admin offline mode): the status the client saw.
   * If the current status differs → 409 CONFLICT with the current record.
   * Status-based (not updatedAt) because payment roll-ups bump updatedAt.
   */
  @IsOptional()
  @IsString()
  expectedStatus?: string;
}
