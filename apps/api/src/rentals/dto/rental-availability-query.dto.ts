import { BadRequestException } from '@nestjs/common';
import { IsDateString } from 'class-validator';

/**
 * Query for the PUBLIC `GET /rentals/availability/:productId`.
 *
 * The endpoint answers one yes/no question for an anonymous shopper, so its
 * inputs are bounded to keep each call cheap and to make bulk calendar
 * scraping slow (it is also throttled per IP in the controller).
 */
export class RentalAvailabilityQueryDto {
  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;
}

/** Longest window one public call may ask about (well above any policy max). */
export const MAX_AVAILABILITY_WINDOW_DAYS = 62;
/** How far ahead a public call may look. */
export const MAX_AVAILABILITY_LOOKAHEAD_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Semantic checks the class-validator decorators can't express. Pure, so it
 * is unit-tested directly (rental-availability.spec.ts). `now` is injected.
 */
export function parseAvailabilityWindow(
  q: { startDate: string; endDate: string },
  now: Date = new Date(),
): { start: Date; end: Date } {
  const start = new Date(q.startDate);
  const end = new Date(q.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('startDate and endDate must be valid dates');
  }
  if (end.getTime() <= start.getTime()) {
    throw new BadRequestException('endDate must be after startDate');
  }
  if (end.getTime() - start.getTime() > MAX_AVAILABILITY_WINDOW_DAYS * DAY_MS) {
    throw new BadRequestException(
      `The rental window may be at most ${MAX_AVAILABILITY_WINDOW_DAYS} days`,
    );
  }
  // Allow "today" in any timezone (a full day of slack), but not the past.
  if (start.getTime() < now.getTime() - DAY_MS) {
    throw new BadRequestException('startDate cannot be in the past');
  }
  if (start.getTime() > now.getTime() + MAX_AVAILABILITY_LOOKAHEAD_DAYS * DAY_MS) {
    throw new BadRequestException(
      `startDate may be at most ${MAX_AVAILABILITY_LOOKAHEAD_DAYS} days ahead`,
    );
  }
  return { start, end };
}
