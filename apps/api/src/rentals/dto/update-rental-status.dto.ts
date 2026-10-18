import { IsString, IsIn, IsOptional } from 'class-validator';

export const RENTAL_STATUSES = [
  'PENDING_ID_VERIFICATION',
  'ID_VERIFIED',
  'DOWN_PAYMENT_PAID',
  'FULLY_PAID',
  'READY_FOR_PICKUP',
  'ITEM_DISPATCHED',
  'ACTIVE',
  'RETURNED',
  'INSPECTION',
  'CLOSED',
  // Terminal. Admin-cancellable only before dispatch; also set by the
  // unpaid-hold expiry cron (SchedulerService.handleExpiredRentalHolds).
  'CANCELLED',
] as const;

export class UpdateRentalStatusDto {
  @IsString()
  @IsIn(RENTAL_STATUSES)
  status: string;

  /**
   * Optimistic concurrency (admin offline mode): the status the client saw.
   * If the current status differs → 409 CONFLICT with the current record.
   * Status-based (not updatedAt) because payment roll-ups bump updatedAt.
   */
  @IsOptional()
  @IsString()
  expectedStatus?: string;
}
