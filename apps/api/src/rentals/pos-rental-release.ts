import { NotFoundException } from '@nestjs/common';

/**
 * Walk-in POS rentals — compile-time RELEASE FLAG.
 *
 * The walk-in POS rental code (`/pos-rentals`, the POS "Rental" mode) is
 * carried in the stack from R1 onwards, but it is NOT released until R5
 * (POS_RENTAL_LAUNCH_PLAN.md §2: "a release may make code available but
 * never activate a rental flow whose controls ship later").
 *
 * While this constant is `false`:
 *  - every `/pos-rentals` route answers 404 `POS_RENTALS_NOT_RELEASED` to
 *    EVERY caller — SUPER_ADMIN and platform admins included — before
 *    authentication, permissions, idempotency or any database access
 *    (`PosRentalsReleaseGuard`, first guard on the controller);
 *  - `RentalsService.create(…, { channel: 'POS' })` refuses before it reads
 *    anything (defence in depth: no other path can book a walk-in rental);
 *  - `GET /pos/capabilities` reports `posRentalsReleased: false`, so the
 *    admin POS page never shows the Rental toggle or mounts the walk-in
 *    screen (and an older admin build that still shows it gets 404s).
 *
 * It is deliberately NOT a SiteSetting, a permission or a production env
 * var: no role grant, tenant setting or server configuration can turn it
 * on. Only a code change can — R5's activation commit flips it to `true`
 * (and updates `pos-rental-release.spec.ts`, which pins it to `false`).
 */
export const POS_RENTALS_RELEASED = false;

/**
 * Test-only override so the real-database suites can exercise the unreleased
 * code. Honoured ONLY when NODE_ENV !== 'production' (production always
 * ignores it — see pos-rental-release.spec.ts).
 */
export const POS_RENTALS_TEST_OVERRIDE_ENV = 'NARO_TEST_UNRELEASED_POS_RENTALS';

export const POS_RENTALS_NOT_RELEASED = 'POS_RENTALS_NOT_RELEASED';

export function posRentalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (POS_RENTALS_RELEASED) return true;
  if (env.NODE_ENV === 'production') return false;
  return env[POS_RENTALS_TEST_OVERRIDE_ENV] === 'true';
}

export function posRentalsNotReleased(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: POS_RENTALS_NOT_RELEASED,
    message: 'Walk-in POS rentals are not available in this release.',
  });
}

/** Throws 404 POS_RENTALS_NOT_RELEASED unless walk-in POS rentals are released. */
export function assertPosRentalsReleased(env: NodeJS.ProcessEnv = process.env): void {
  if (!posRentalsEnabled(env)) throw posRentalsNotReleased();
}
