import { CanActivate, Injectable } from '@nestjs/common';
import { assertPosRentalsReleased } from './pos-rental-release';

/**
 * First guard on every `/pos-rentals` route. Refuses ALL callers (no user,
 * role or permission is consulted — SUPER_ADMIN and platform admins too)
 * with 404 POS_RENTALS_NOT_RELEASED until walk-in POS rentals are released
 * (`POS_RENTALS_RELEASED`, R5). Guards run before interceptors, so a refused
 * request never reaches the idempotency store, the handler or the database.
 */
@Injectable()
export class PosRentalsReleaseGuard implements CanActivate {
  canActivate(): boolean {
    assertPosRentalsReleased();
    return true;
  }
}
