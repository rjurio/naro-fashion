import { IsString, IsIn } from 'class-validator';

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
] as const;

export class UpdateRentalStatusDto {
  @IsString()
  @IsIn(RENTAL_STATUSES)
  status: string;
}
