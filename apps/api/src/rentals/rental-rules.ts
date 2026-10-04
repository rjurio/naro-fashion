import { BadRequestException } from '@nestjs/common';
import { eatCalendarDaysBetween } from '../reports/eat-time.util';

/**
 * Pure rental business rules shared by RentalsService (state machine, late
 * fee, availability) and SchedulerService (unpaid-hold expiry). No DI, no
 * Prisma — unit-testable in isolation.
 */

/** Forward-only lifecycle. CANCELLED sits outside it (terminal side-exit). */
export const RENTAL_WORKFLOW = [
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

/**
 * Statuses that do NOT hold the gown for availability purposes. CANCELLED
 * must be here or a cancelled/expired booking keeps blocking the dates.
 */
export const NON_BLOCKING_RENTAL_STATUSES = ['CLOSED', 'RETURNED', 'INSPECTION', 'CANCELLED'];

/**
 * Pre-payment "hold" statuses. A rental in one of these with no COMPLETED
 * payment after RENTAL_HOLD_TTL_HOURS is auto-cancelled so an abandoned
 * booking can't block the gown forever. ID_VERIFIED is included: in this
 * workflow it is the "awaiting down payment" state. PENDING_PAYMENT/PENDING
 * are legacy values still recognised by the payment reconciliation path.
 */
export const UNPAID_HOLD_STATUSES = [
  'PENDING_ID_VERIFICATION',
  'PENDING_PAYMENT',
  'PENDING',
  'ID_VERIFIED',
];

/** Statuses from which an admin may cancel (nothing has left the shop yet). */
const CANCELLABLE_FROM = new Set([
  'PENDING_ID_VERIFICATION',
  'PENDING_PAYMENT',
  'PENDING',
  'ID_VERIFIED',
  'DOWN_PAYMENT_PAID',
  'FULLY_PAID',
  'READY_FOR_PICKUP',
  'CONFIRMED',
]);

export const DEFAULT_RENTAL_HOLD_TTL_HOURS = 48;

/**
 * Throws unless `from → to` is a legal admin transition:
 *  - forward-only along RENTAL_WORKFLOW;
 *  - may NOT jump over RETURNED: RETURNED is the only step that stamps
 *    actualReturnDate and assesses the late fee, so ACTIVE → INSPECTION/CLOSED
 *    (which silently skipped both) is rejected;
 *  - CANCELLED only from pre-dispatch states, and is terminal.
 */
export function assertRentalTransition(from: string, to: string): void {
  if (from === 'CANCELLED' || from === 'CLOSED') {
    throw new BadRequestException(`Rental is ${from} and can no longer change status.`);
  }
  if (to === 'CANCELLED') {
    if (!CANCELLABLE_FROM.has(from)) {
      throw new BadRequestException(
        `Cannot cancel a rental in ${from}. Only rentals that have not been dispatched can be cancelled.`,
      );
    }
    return;
  }

  const wf = RENTAL_WORKFLOW as readonly string[];
  const currentIndex = wf.indexOf(from);
  const targetIndex = wf.indexOf(to);
  if (targetIndex < 0) throw new BadRequestException(`Unknown rental status ${to}.`);
  if (targetIndex <= currentIndex) {
    throw new BadRequestException(
      `Cannot move from ${from} to ${to}. Status can only advance forward.`,
    );
  }
  const returnedIndex = wf.indexOf('RETURNED');
  if (currentIndex < returnedIndex && targetIndex > returnedIndex) {
    throw new BadRequestException(
      `Cannot move from ${from} to ${to}: the rental must be marked RETURNED first (records the return date and late fee).`,
    );
  }
}

/**
 * Late fee from the BOOKED return date (rental.returnDate), not from
 * product.maxRentalDays counted from startDate (which charged a customer who
 * booked a long rental and returned on time, and missed one who booked short
 * and returned late). Lateness is whole EAT calendar days between the booked
 * return date and the actual return.
 *
 * Fee per late day = latePenaltyPercent% of the flat rental price charged at
 * booking (rental.totalRentalPrice). If that yields 0 (no price/pct), the
 * tenant RentalPolicy.lateFeePerDay is used.
 */
export function computeLateFee(params: {
  bookedReturnDate: Date;
  actualReturnDate: Date;
  flatRentalPrice: number;
  latePenaltyPercent?: number | null;
  policyLateFeePerDay?: number | null;
}): { daysLate: number; lateFee: number } {
  const daysLate = Math.max(
    0,
    eatCalendarDaysBetween(params.bookedReturnDate, params.actualReturnDate),
  );
  if (daysLate === 0) return { daysLate, lateFee: 0 };
  const pct = params.latePenaltyPercent ?? 10;
  let perDay = (params.flatRentalPrice * pct) / 100;
  if (!(perDay > 0)) perDay = Number(params.policyLateFeePerDay ?? 0);
  return { daysLate, lateFee: Math.round(perDay * daysLate * 100) / 100 };
}
