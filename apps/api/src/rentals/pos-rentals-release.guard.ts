import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POS_RENTAL_SERVICING_ROUTE, posRentalsEnabled, posRentalsNotReleased } from './pos-rental-release';

/**
 * First guard on every `/pos-rentals` route. Until walk-in POS rentals are
 * released (`POS_RENTALS_RELEASED`, R5) it refuses ALL callers (no user,
 * role or permission is consulted — SUPER_ADMIN and platform admins too)
 * with 404 POS_RENTALS_NOT_RELEASED, except the routes marked
 * @PosRentalServicingRoute() (existing-booking servicing), which continue to
 * the normal JWT / module / admin / permission guards. Guards run before
 * interceptors, so a refused request never reaches the idempotency store,
 * the handler or the database.
 */
@Injectable()
export class PosRentalsReleaseGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (posRentalsEnabled()) return true;
    if (this.reflector.get<boolean>(POS_RENTAL_SERVICING_ROUTE, context.getHandler()) === true) return true;
    throw posRentalsNotReleased();
  }
}
