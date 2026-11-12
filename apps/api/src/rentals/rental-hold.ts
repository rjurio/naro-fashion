import { eatDayBounds } from '../reports/eat-time.util';
import { DEFAULT_RENTAL_HOLD_TTL_HOURS } from './rental-rules';

/**
 * Unconfirmed-booking ("hold") deadline rules — owner-approved 2026-11-12.
 *
 * A booking that is not yet confirmed (PENDING_ID_VERIFICATION / ID_VERIFIED,
 * legacy PENDING_PAYMENT / PENDING) holds the item's dates. It carries an
 * EXPLICIT, stored deadline (`RentalOrder.holdExpiresAt`) and the reason for
 * it (`RentalOrder.holdState`), so staff and the audit trail can always see
 * why and until when a booking is held:
 *
 *  | holdState              | when                                   | deadline                    |
 *  |------------------------|----------------------------------------|-----------------------------|
 *  | AWAITING_ID            | no ID submitted (or only a rejected one)| booked + 48 h (unchanged)   |
 *  | ID_UNDER_REVIEW        | an ID is waiting for staff review       | none: the clock is PAUSED   |
 *  | ID_REJECTED            | staff rejected the ID                   | rejected + 48 h to resubmit |
 *  | AWAITING_DOWN_PAYMENT  | ID approved, a down payment is due      | approved + 48 h (fresh)     |
 *  | NO_DOWN_PAYMENT        | ID approved, 0 % down payment           | none: no payment to wait for|
 *
 * Separately, the PICKUP DATE is an expiry for every unconfirmed booking:
 * once the EAT calendar day of `pickupDate` has ended, it can no longer be
 * collected as booked, so it is released (no-show / expired). This is what
 * stops a paused or 0 % booking from staying open indefinitely.
 *
 * Never auto-cancelled: a booking with any COMPLETED payment (money received
 * -> staff decide, refunds are a manual review), and — for a grace period — a
 * booking with an in-flight PENDING / PROCESSING payment.
 *
 * All instants are absolute (UTC in the DB); "pickup day" is the EAT
 * (Africa/Dar_es_Salaam, UTC+3, no DST) calendar day containing pickupDate.
 * Pure functions: no DI, no Prisma.
 */
export const HOLD_STATES = [
  'AWAITING_ID',
  'ID_UNDER_REVIEW',
  'ID_REJECTED',
  'AWAITING_DOWN_PAYMENT',
  'NO_DOWN_PAYMENT',
] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** States whose deadline is a running clock (the others have none). */
export const TIMED_HOLD_STATES: readonly HoldState[] = ['AWAITING_ID', 'ID_REJECTED', 'AWAITING_DOWN_PAYMENT'];

/** A customer's National ID situation, read from their documents. */
export type CustomerIdState = 'APPROVED' | 'PENDING' | 'REJECTED' | 'NONE';

/**
 * An in-flight (PENDING / PROCESSING) payment created this recently protects
 * an expired booking from auto-cancellation, so a Mobile Money payment
 * started before the deadline (PIN slow, webhook late) is not cancelled
 * under the customer. Once it resolves (or is older than this), the next run
 * decides.
 */
export const INFLIGHT_PAYMENT_GRACE_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** RENTAL_HOLD_TTL_HOURS (default 48). One value for every timed window. */
export function rentalHoldTtlHours(raw: string | number | undefined = process.env.RENTAL_HOLD_TTL_HOURS): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RENTAL_HOLD_TTL_HOURS;
}

export interface HoldDecision {
  holdState: HoldState;
  holdExpiresAt: Date | null;
}

/**
 * The hold for a booking given the customer's ID state at `at` (the moment
 * of the event: booking created, ID submitted / approved / rejected).
 */
export function decideHold(input: {
  idState: CustomerIdState;
  downPaymentAmount: number;
  at: Date;
  ttlHours?: number;
}): HoldDecision {
  const ttl = (input.ttlHours ?? rentalHoldTtlHours()) * HOUR_MS;
  switch (input.idState) {
    case 'APPROVED':
      return input.downPaymentAmount > 0
        ? { holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: new Date(input.at.getTime() + ttl) }
        : { holdState: 'NO_DOWN_PAYMENT', holdExpiresAt: null };
    case 'PENDING':
      return { holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null };
    case 'REJECTED':
    case 'NONE':
    default:
      return { holdState: 'AWAITING_ID', holdExpiresAt: new Date(input.at.getTime() + ttl) };
  }
}

/** Hold after staff reject the ID: a fresh window to send a new one. */
export function rejectedHold(at: Date, ttlHours?: number): HoldDecision {
  return {
    holdState: 'ID_REJECTED',
    holdExpiresAt: new Date(at.getTime() + (ttlHours ?? rentalHoldTtlHours()) * HOUR_MS),
  };
}

/**
 * First instant at which a booking with this pickup date counts as expired:
 * 00:00 EAT of the day AFTER the pickup day.
 */
export function pickupExpiryAt(pickupDate: Date): Date {
  return new Date(eatDayBounds(pickupDate).end.getTime() + 1);
}

/**
 * Cut-off for the pickup expiry query: a booking expires when its pickupDate
 * is before 00:00 EAT today (= its pickup day has ended).
 */
export function pickupCutoff(now: Date): Date {
  return eatDayBounds(now).start;
}

export type HoldExpiryReason = 'HOLD_DEADLINE' | 'PICKUP_DATE_PASSED';

/** Why (if at all) an unconfirmed booking has expired at `now`. */
export function holdExpiryReason(
  rental: { holdExpiresAt: Date | null; pickupDate: Date },
  now: Date,
): HoldExpiryReason | null {
  if (rental.holdExpiresAt && rental.holdExpiresAt.getTime() <= now.getTime()) return 'HOLD_DEADLINE';
  if (rental.pickupDate.getTime() < pickupCutoff(now).getTime()) return 'PICKUP_DATE_PASSED';
  return null;
}

/** Customer-facing explanation of an auto-cancellation (email + notes). */
export function holdExpiryMessage(reason: HoldExpiryReason, holdState: string | null): string {
  if (reason === 'PICKUP_DATE_PASSED') {
    return 'The pickup date passed before the booking was confirmed.';
  }
  switch (holdState) {
    case 'AWAITING_ID':
      return 'No National ID was submitted in time.';
    case 'ID_REJECTED':
      return 'A new National ID was not submitted in time after the previous one was not approved.';
    case 'AWAITING_DOWN_PAYMENT':
      return 'The down payment was not received in time after the ID was approved.';
    default:
      return 'The booking was not confirmed in time.';
  }
}

/**
 * Legacy adoption: a booking created before these rules has no holdState.
 * Classify it from the customer's documents as they stand. The resulting
 * deadline is never earlier than the old rule's (created + 48 h), so the
 * first deploy cancels nothing the old cron would not already have.
 */
export function adoptLegacyHold(input: {
  status: string;
  createdAt: Date;
  downPaymentAmount: number;
  idState: CustomerIdState;
  /** verifiedAt of the approved document (APPROVED). */
  approvedAt?: Date | null;
  /** updatedAt of the latest rejected document (REJECTED). */
  rejectedAt?: Date | null;
  ttlHours?: number;
}): HoldDecision {
  const ttlHours = input.ttlHours ?? rentalHoldTtlHours();
  const later = (d?: Date | null) =>
    d && d.getTime() > input.createdAt.getTime() ? d : input.createdAt;
  if (input.status === 'PENDING_PAYMENT' || input.status === 'PENDING') {
    // Legacy statuses: keep the old treatment (created + 48 h).
    return { holdState: 'AWAITING_DOWN_PAYMENT', holdExpiresAt: new Date(input.createdAt.getTime() + ttlHours * HOUR_MS) };
  }
  if (input.idState === 'APPROVED') {
    return decideHold({ idState: 'APPROVED', downPaymentAmount: input.downPaymentAmount, at: later(input.approvedAt), ttlHours });
  }
  if (input.idState === 'REJECTED') {
    const at = later(input.rejectedAt);
    return at === input.createdAt
      ? decideHold({ idState: 'NONE', downPaymentAmount: input.downPaymentAmount, at, ttlHours })
      : rejectedHold(at, ttlHours);
  }
  return decideHold({ idState: input.idState, downPaymentAmount: input.downPaymentAmount, at: input.createdAt, ttlHours });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Nov 2026, 15:00 EAT" — a deadline as the customer reads it. */
export function formatEatDeadline(at: Date): string {
  const shifted = new Date(at.getTime() + 3 * HOUR_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()}, ${hh}:${mm} EAT`;
}
