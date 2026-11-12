import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { conflictException } from '../common/offline-sync.util';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { ownerScope } from '../auth/util/ownership';
import {
  RentalTerms,
  RentalTermsPolicy,
  RentalTermsProduct,
  publicQuote,
  quotedTermsDiffer,
  rentalTerms,
  shopDownPaymentPct,
} from './rental-terms';

const termsLogger = new Logger('RentalTerms');
// One warning per (tenant, product, setting, value): the quote is public and
// can be called often; a bad setting is logged once per process, not per call.
const warnedSettings = new Set<string>();
const MAX_WARNED = 1000;

export const RENTAL_TERMS_CHANGED = 'RENTAL_TERMS_CHANGED';
export const RENTAL_TERMS_UNAVAILABLE = 'RENTAL_TERMS_UNAVAILABLE';
import { Decimal } from '@prisma/client/runtime/library';
import {
  NON_BLOCKING_RENTAL_STATUSES,
  UNPAID_HOLD_STATUSES,
  assertRentalTransition,
  computeLateFee,
  resolveReturnedAt,
  transitionRequiresApprovedId,
  ID_NOT_APPROVED,
  ID_NOT_APPROVED_MESSAGE,
} from './rental-rules';
import { notAvailableForRental } from './rental-sale-guard';
import { findRentalAvailability, findRentalAvailabilityBlock, RentalBlockReason } from './rental-availability';
import { customerIdState, hasApprovedId, lockCustomerIdState } from '../id-verification/id-approval';
import { decideHold, MAX_STAFF_EXTENSION_DAYS, pickupCutoff, pickupExpiryAt } from './rental-hold';
import { rentalBalances } from './rental-ledger';
import { userHasPermission } from '../auth/util/permission-check';

/** Statuses that mean the item has been handed over. */
const RELEASE_TARGETS = ['ITEM_DISPATCHED', 'ACTIVE'];
const HANDED_OVER = ['ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED'];
import { ExtendRentalHoldDto } from './dto/rental-hold-actions.dto';

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  /**
   * rentalTerms() plus the operational side: warn (ids and the bad value
   * only, no customer data) about ignored invalid settings, and refuse to
   * quote or book on amounts that can't be used.
   */
  private termsFor(
    product: RentalTermsProduct & { rentalDownPaymentPct?: unknown; rentalDownPaymentMode?: string | null },
    policy: RentalTermsPolicy | null | undefined,
    tenantId: string,
    productId: string,
  ): RentalTerms {
    const t = rentalTerms(product as RentalTermsProduct, policy);
    for (const setting of t.invalidSettings) {
      const value =
        setting === 'product' ? product.rentalDownPaymentPct
          : setting === 'mode' ? product.rentalDownPaymentMode
            : policy?.defaultDownPaymentPct;
      const perProduct = setting !== 'shop';
      const key = `${tenantId}|${perProduct ? productId : '-'}|${setting}|${String(value)}`;
      if (warnedSettings.has(key)) continue;
      if (warnedSettings.size >= MAX_WARNED) warnedSettings.clear();
      warnedSettings.add(key);
      termsLogger.warn(
        `[RENTAL_TERMS] invalid ${setting === 'mode' ? 'product down-payment mode' : `${setting} down-payment %`} ignored ` +
          `tenant=${tenantId}${perProduct ? ` product=${productId}` : ''} value=${JSON.stringify(String(value)).slice(0, 40)} ` +
          `→ using ${t.downPaymentSource === 'product' ? "the product's stored %" : t.downPaymentSource === 'shop' ? 'the shop default' : 'the 25% fallback'} (${t.downPaymentPct}%)`,
      );
    }
    if (!t.usable) {
      termsLogger.warn(
        `[RENTAL_TERMS] unusable rental amounts tenant=${tenantId} product=${productId} (no valid rental fee / deposit)`,
      );
      throw new UnprocessableEntityException({
        code: RENTAL_TERMS_UNAVAILABLE,
        message: 'This item has no valid rental price yet. Please contact the store.',
      });
    }
    return t;
  }

  /**
   * The ONE booking path, shared by the storefront (ONLINE) and walk-in POS
   * bookings (POS rental MVP, M3). Same availability rule, locks, ID rule,
   * hold deadline and money terms; only the profile requirements differ:
   *  - ONLINE: full name, phone, email and an address (unchanged);
   *  - POS: full name and phone; email optional; the address is required
   *    before HANDOVER (assertReleasable), not to book.
   */
  async create(
    userId: string,
    dto: CreateRentalDto,
    opts: { channel?: 'ONLINE' | 'POS'; createdByAdminId?: string; termsAccepted?: boolean } = {},
  ) {
    const channel = opts.channel ?? 'ONLINE';
    // Verify customer profile completeness before rental
    const tenantId = this.tenantContext.requireId;
    const user = await this.prisma.user.findUnique({
      where: { id: userId, tenantId },
      include: { addresses: { take: 1 } },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.firstName || !user.lastName) {
      throw new BadRequestException(
        'Please complete your profile with your full name before renting',
      );
    }
    if (!user.phone) {
      throw new BadRequestException(
        'Please add your phone number to your profile before renting',
      );
    }
    if (channel === 'ONLINE' && !user.email) {
      throw new BadRequestException(
        'Please add your email address to your profile before renting',
      );
    }
    if (channel === 'ONLINE' && user.addresses.length === 0) {
      throw new BadRequestException(
        'Please add an address to your profile before renting',
      );
    }
    if (channel === 'POS' && opts.termsAccepted !== true) {
      throw new BadRequestException('The customer must accept the rental terms before the booking is made.');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (
      product.availabilityMode !== 'RENTAL_ONLY' &&
      product.availabilityMode !== 'BOTH'
    ) {
      throw new BadRequestException('Product is not available for rental');
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.variantId, tenantId },
    });
    if (!variant || variant.productId !== dto.productId || variant.isActive === false) {
      throw new NotFoundException('Product variant not found');
    }

    const startDate = new Date(dto.startDate);
    const returnDate = new Date(dto.returnDate);
    const pickupDate = new Date(dto.pickupDate);

    if (startDate >= returnDate) {
      throw new BadRequestException('Return date must be after start date');
    }
    if (pickupDate > startDate) {
      throw new BadRequestException(
        'Pickup date must be on or before start date',
      );
    }

    const policy = await this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
    });
    const bufferDays =
      product.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;
    const maxDuration = policy?.maxRentalDurationDays ?? 30;

    const rentalDays = Math.ceil(
      (returnDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (rentalDays > maxDuration) {
      throw new BadRequestException(
        `Rental duration exceeds maximum of ${maxDuration} days`,
      );
    }

    // Fast pre-check for a quick answer: the SAME rule the availability
    // endpoint uses. Not trusted: it is repeated under the lock below.
    // M2: the chosen variant (size) — on unit-managed products a unit must fit it.
    const query = { tenantId, product, startDate, returnDate, bufferDays, variantId: dto.variantId };
    const early = await findRentalAvailabilityBlock(this.prisma, query);
    if (early) throw this.bookingRefusal(early);

    // New pricing: flat rental price for the entire rental within maxRentalDays.
    // If returned within maxRentalDays → customer pays only the flat price.
    // If returned after maxRentalDays → customer pays flat price PLUS
    //   latePenaltyPercent% of flat price per day late.
    // The stored totalRentalPrice here is the flat price at booking time;
    //   any late fee is assessed on actual return in the rental controller.
    // One rule for the money terms (rental-terms.ts), shared with the public
    // quote the storefront displays: product % → shop default % → 25 %.
    // The booking computes and stores its OWN amounts; the quote is advisory.
    const terms = this.termsFor(product, policy, tenantId, dto.productId);
    // If the customer was shown different amounts (a price or policy change
    // after the page loaded), refuse rather than store terms they haven't seen.
    if (quotedTermsDiffer(dto, terms)) {
      throw new ConflictException({
        code: RENTAL_TERMS_CHANGED,
        message:
          'The rental terms changed after this page was loaded. Please review the new amounts and request the booking again.',
        current: publicQuote(terms),
      });
    }
    const depositAmount = terms.deposit;
    const totalRentalPrice = terms.rentalFee;
    const downPaymentAmount = terms.downPayment;

    const rentalNumber = `RNT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // The pre-check above and the insert are separate statements: a booking
    // or sale committed in between would be missed. So the authoritative
    // check runs again INSIDE the transaction, after the per-product advisory
    // lock that every booking and every sale path takes
    // (pg_advisory_xact_lock(hashtext(productId))). Only one of them runs
    // for a given gown at a time, and each sees what the previous committed.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.productId}))`;

      const availability = await findRentalAvailability(tx, query);
      if (availability.block) throw this.bookingRefusal(availability.block);

      // National ID: read under the per-customer lock ID approval also takes,
      // so a booking and an approval for the same customer never interleave
      // (else the booking could be stored PENDING_ID_VERIFICATION right after
      // the approval reconciled the customer's waiting bookings). A request
      // without an approved ID is still accepted (owner rule 2026-11-12).
      await lockCustomerIdState(tx, tenantId, userId);
      const approved = await hasApprovedId(tx, tenantId, userId);
      const initialStatus = approved ? 'ID_VERIFIED' : 'PENDING_ID_VERIFICATION';

      // Explicit hold deadline (rentals/rental-hold.ts, owner rules
      // 2026-11-12): no ID yet -> 48 h to submit one; ID waiting for staff
      // review -> paused; ID approved -> 48 h to pay the down payment, or no
      // payment deadline when none is due. Read under the same lock.
      const idState = approved ? 'APPROVED' : (await customerIdState(tx, tenantId, userId)).state;
      const hold = decideHold({ idState, downPaymentAmount: Number(downPaymentAmount), at: new Date() });

      return tx.rentalOrder.create({
        data: {
          tenantId,
          rentalNumber,
          userId,
          productId: dto.productId,
          variantId: dto.variantId,
          startDate,
          returnDate,
          pickupDate,
          totalRentalPrice,
          downPaymentAmount,
          damageDeposit: depositAmount,
          status: initialStatus,
          // M2: the physical unit, allocated under the per-product lock (null: legacy product).
          rentalUnitId: availability.unitId,
          channel,
          createdByAdminId: channel === 'POS' ? opts.createdByAdminId ?? null : null,
          termsAcceptedAt: channel === 'POS' ? new Date() : null,
          holdState: hold.holdState,
          holdExpiresAt: hold.holdExpiresAt,
          notes: dto.notes,
          pickupTime: dto.pickupTime,
          weddingDate: dto.weddingDate ? new Date(dto.weddingDate) : undefined,
          weddingLocation: dto.weddingLocation,
          weddingRegion: dto.weddingRegion,
          deliveryModality: dto.deliveryModality,
          shippingDate: dto.shippingDate ? new Date(dto.shippingDate) : undefined,
          shippingAddress: dto.shippingAddress,
          transportMode: dto.transportMode,
        },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, name: true, sku: true } },
        },
      });
    });
  }

  async findAll(userId: string) {
    return this.prisma.rentalOrder.findMany({
      where: { userId, tenantId: this.tenantContext.requireId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, slug: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  async findAllAdmin(query: QueryRentalsDto) {
    const { status, startDate, endDate, page = 1, limit = 20 } = query;
    const where: any = { tenantId: this.tenantContext.requireId };

    if (status) {
      where.status = status;
    }
    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [rentals, total] = await Promise.all([
      this.prisma.rentalOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          product: { select: { id: true, name: true, slug: true } },
          variant: { select: { id: true, name: true } },
        },
      }),
      this.prisma.rentalOrder.count({ where }),
    ]);

    return {
      data: rentals,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, user: any) {
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantContext.requireId, ...ownerScope(user) },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { take: 1, where: { isPrimary: true } },
          },
        },
        variant: { select: { id: true, name: true, sku: true } },
        checklist: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    return rental;
  }

  async updateStatus(id: string, status: string, expectedStatus?: string, user?: any, returnedAtRaw?: string) {
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    // Optimistic concurrency (admin offline mode): status the client saw.
    // Checked before transition validation; the CAS below (on rental.status
    // == expectedStatus) also maps a racing change to CONFLICT.
    const staleConflict = async () =>
      conflictException(
        await this.findOne(id, user ?? { isAdmin: true }).catch(() => null),
      );
    if (expectedStatus !== undefined && expectedStatus !== rental.status) {
      throw await staleConflict();
    }

    // Forward-only, no jumping over RETURNED (the only step that records
    // actualReturnDate + late fee), CANCELLED only before dispatch.
    assertRentalTransition(rental.status, status);

    // National ID (owner rule 2026-11-12): while the item is in the shop, no
    // transition other than cancelling may happen without an APPROVED ID —
    // checked against the customer's documents now, whatever the rental's
    // status says. Covers every jump (e.g. PENDING_ID_VERIFICATION straight
    // to READY_FOR_PICKUP / ACTIVE) and offline replays.
    await this.assertApprovedIdFor(rental, status);

    // POS rental MVP (M3): handing the item over (dispatch / collection) is a
    // separate permission and needs everything settled first.
    if (RELEASE_TARGETS.includes(status) && !RELEASE_TARGETS.includes(rental.status) && !HANDED_OVER.includes(rental.status)) {
      if (user && !(await userHasPermission(this.prisma as any, user, 'rentals:release'))) {
        throw new ForbiddenException({ statusCode: 403, code: 'RELEASE_NOT_PERMITTED', message: 'Handing an item over needs the "rentals:release" permission.' });
      }
      await this.assertReleasable(rental);
    }

    const data: any = { status };
    if (status === 'ID_VERIFIED') {
      // Staff moved the booking to ID_VERIFIED by hand (the approved ID was
      // just checked): same fresh payment window as an ID approval.
      Object.assign(
        data,
        decideHold({ idState: 'APPROVED', downPaymentAmount: Number(rental.downPaymentAmount), at: new Date() }),
      );
    }
    if (status === 'CANCELLED') {
      // Money still held on a cancelled booking is flagged REFUND_DUE: an
      // outstanding liability, never forfeited and never treated as refunded.
      // Recording the payout belongs to the rental refund ledger (proposed
      // release after P0c), not to this flag.
      const held = await this.netPaid(rental.id);
      if (held > 0) {
        data.holdState = 'REFUND_DUE';
        data.holdExpiresAt = null;
      }
    }
    if (status === 'RETURNED') {
      // Offline replays carry the real return time (validated, ≤30 days old).
      const resolved = resolveReturnedAt(returnedAtRaw, new Date());
      if ('error' in resolved) throw new BadRequestException(resolved.error);
      const returnedAt = resolved.at;
      data.actualReturnDate = returnedAt;

      // Late fee from the BOOKED return date (rental.returnDate), in whole
      // EAT days — see computeLateFee.
      const tenantId = this.tenantContext.requireId;
      const [product, policy] = await Promise.all([
        this.prisma.product.findFirst({
          where: { id: rental.productId, tenantId },
          select: { latePenaltyPercent: true },
        }),
        this.prisma.rentalPolicy.findFirst({ where: { tenantId } }),
      ]);
      const { lateFee } = computeLateFee({
        bookedReturnDate: rental.returnDate,
        actualReturnDate: returnedAt,
        flatRentalPrice: Number(rental.totalRentalPrice),
        latePenaltyPercent:
          product?.latePenaltyPercent != null ? Number(product.latePenaltyPercent) : null,
        policyLateFeePerDay: policy ? Number(policy.lateFeePerDay) : null,
      });
      data.lateFee = lateFee;
    }

    // Compare-and-swap on the status we validated against, so two admins
    // can't both apply transitions computed from the same stale read.
    const claim = await this.prisma.rentalOrder.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: rental.status },
      data,
    });
    if (claim.count === 0) {
      if (expectedStatus !== undefined) throw await staleConflict();
      throw new ConflictException('Rental status changed concurrently. Reload and try again.');
    }

    const updated = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
      include: {
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
    await this.auditService.log('UPDATE_STATUS', 'Rental', id, {
      from: rental.status,
      to: status,
      ...(data.holdState !== undefined && { holdState: data.holdState, holdExpiresAt: data.holdExpiresAt }),
    });
    return updated;
  }

  /** COMPLETED minus REFUNDED payments on a rental (money still held). */
  private async netPaid(rentalOrderId: string): Promise<number> {
    const tenantId = this.tenantContext.requireId;
    const [c, r] = await Promise.all([
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { rentalOrderId, tenantId, status: 'COMPLETED' } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { rentalOrderId, tenantId, status: 'REFUNDED' } }),
    ]);
    return Math.max(0, Math.round((Number(c._sum.amount ?? 0) - Number(r._sum.amount ?? 0)) * 100) / 100);
  }

  /**
   * Staff give an unconfirmed booking a new deadline (rentals/rental-hold.ts):
   * e.g. a PAYMENT_REVIEW booking whose customer will pay the rest, or a
   * customer who asked for more time. Bounded: in the future, at most
   * MAX_STAFF_EXTENSION_DAYS (7) from now, and never past the end of the
   * pickup day (reschedule first). PAYMENT_REVIEW returns to the waiting
   * state for what is still missing. Under the per-customer lock, CAS on the
   * observed hold, audited (HOLD_EXTENDED). A new deadline also re-arms the
   * customer reminder.
   */
  async extendHold(id: string, dto: ExtendRentalHoldDto) {
    const tenantId = this.tenantContext.requireId;
    const until = new Date(dto.until);
    const now = new Date();
    if (isNaN(until.getTime()) || until.getTime() <= now.getTime() + 60_000) {
      throw new BadRequestException('The new deadline must be in the future.');
    }
    if (until.getTime() > now.getTime() + MAX_STAFF_EXTENSION_DAYS * 86_400_000) {
      throw new BadRequestException(`A deadline can be extended by at most ${MAX_STAFF_EXTENSION_DAYS} days at a time.`);
    }
    const rental = await this.prisma.rentalOrder.findFirst({ where: { id, tenantId } });
    if (!rental) throw new NotFoundException('Rental order not found');
    const extendable = ['PAYMENT_REVIEW', 'AWAITING_ID', 'ID_REJECTED', 'AWAITING_DOWN_PAYMENT'];
    if (!UNPAID_HOLD_STATUSES.includes(rental.status) || !extendable.includes(rental.holdState ?? '')) {
      throw new BadRequestException(
        `Only an unconfirmed booking waiting for the customer or for payment review can be extended (status ${rental.status}, hold ${rental.holdState ?? 'none'}).`,
      );
    }
    if (rental.pickupDate.getTime() < pickupCutoff(now).getTime()) {
      throw new BadRequestException('The pickup day has passed: reschedule the pickup first.');
    }
    if (until.getTime() > pickupExpiryAt(rental.pickupDate).getTime()) {
      throw new BadRequestException('The new deadline is after the end of the pickup day: reschedule the pickup first.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockCustomerIdState(tx, tenantId, rental.userId);
      let nextState = rental.holdState as string;
      if (nextState === 'PAYMENT_REVIEW') {
        nextState = (await hasApprovedId(tx, tenantId, rental.userId)) ? 'AWAITING_DOWN_PAYMENT' : 'AWAITING_ID';
      }
      const res = await tx.rentalOrder.updateMany({
        where: { id, tenantId, status: rental.status, holdState: rental.holdState, holdExpiresAt: rental.holdExpiresAt },
        data: { holdState: nextState, holdExpiresAt: until },
      });
      return res.count > 0 ? nextState : null;
    });
    if (!result) throw new ConflictException('The booking changed meanwhile. Reload and try again.');
    await this.auditService.log('HOLD_EXTENDED', 'Rental', id, {
      from: { holdState: rental.holdState, holdExpiresAt: rental.holdExpiresAt },
      to: { holdState: result, holdExpiresAt: until },
      note: dto.note,
    });
    return this.findOne(id, { isAdmin: true });
  }
  async markReadyForPickup(id: string) {
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }
    // "Ready for pickup" tells staff the item can be handed over: same ID rule.
    await this.assertApprovedIdFor(rental, 'READY_FOR_PICKUP');

    const marked = await this.prisma.rentalOrder.update({
      where: { id },
      data: { isReadyForPickup: true },
    });
    await this.auditService.log('MARK_READY', 'Rental', id);
    return marked;
  }

  /**
   * Handover gate (owner requirement, POS rental MVP M3): the item may leave
   * the shop only when the customer has an approved National ID, the WHOLE
   * rental fee and the WHOLE refundable deposit are received (rental money
   * ledger), the customer has an address on file, and — on a unit-managed
   * product — a unit is allocated and in service. 422 HANDOVER_BLOCKED with
   * the list of what is missing; nothing written.
   */
  async assertReleasable(rental: Parameters<typeof rentalBalances>[0] & { id: string; userId: string; productId: string; rentalUnitId?: string | null }) {
    const tenantId = this.tenantContext.requireId;
    const missing: string[] = [];
    if (!(await hasApprovedId(this.prisma, tenantId, rental.userId))) missing.push('APPROVED_ID');
    const [payments, requests, addresses, units, unit] = await Promise.all([
      this.prisma.payment.findMany({ where: { rentalOrderId: rental.id, tenantId }, select: { amount: true, status: true, component: true } }),
      this.prisma.rentalRefundRequest?.findMany?.({ where: { rentalOrderId: rental.id, tenantId }, select: { component: true, amount: true, retainedAmount: true, status: true } }) ?? [],
      this.prisma.address.count({ where: { userId: rental.userId } }),
      this.prisma.rentalUnit?.count?.({ where: { tenantId, productId: rental.productId } }) ?? 0,
      rental.rentalUnitId ? this.prisma.rentalUnit.findFirst({ where: { id: rental.rentalUnitId, tenantId }, select: { status: true } }) : null,
    ]);
    const b = rentalBalances(rental, payments, requests ?? []);
    if (!b.feeFullyPaid) missing.push('FULL_RENTAL_FEE');
    if (!b.depositFullyPaid) missing.push('DEPOSIT');
    if (addresses === 0) missing.push('ADDRESS');
    if ((units ?? 0) > 0 && (!unit || unit.status !== 'ACTIVE')) missing.push('UNIT');
    if (missing.length === 0) return;
    await this.auditService.log('RELEASE_BLOCKED', 'Rental', rental.id, { missing });
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'HANDOVER_BLOCKED',
      missing,
      outstanding: b.outstanding,
      message: `The item can't be handed over yet: ${missing.join(', ')}.`,
    });
  }

  /**
   * Refuse (422 ID_NOT_APPROVED, audited) a transition that needs an approved
   * National ID when the rental's customer has none. See
   * transitionRequiresApprovedId (rental-rules.ts).
   */
  private async assertApprovedIdFor(
    rental: { id: string; status: string; userId: string | null },
    target: string,
  ): Promise<void> {
    if (!transitionRequiresApprovedId(rental.status, target)) return;
    const tenantId = this.tenantContext.requireId;
    if (await hasApprovedId(this.prisma, tenantId, rental.userId)) return;
    await this.auditService.log('UPDATE_STATUS_DENIED', 'Rental', rental.id, {
      from: rental.status,
      to: target,
      reason: ID_NOT_APPROVED,
    });
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: ID_NOT_APPROVED,
      message: ID_NOT_APPROVED_MESSAGE,
    });
  }

  async getAvailability(
    productId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const tenantId = this.tenantContext.requireId;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid dates');
    }
    if (startDate >= endDate) {
      throw new BadRequestException('endDate must be after startDate');
    }
    // Public endpoint: only active, rental-eligible products of THIS tenant.
    // Anything else is the same 404 (no hint whether it exists/is hidden).
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        isActive: true,
        deletedAt: null,
        availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
      },
      select: { id: true, availabilityMode: true, isActive: true, deletedAt: true, bufferDaysOverride: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const policy = await this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
      select: { bufferDaysBetweenRentals: true },
    });
    const bufferDays =
      product.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;

    // Exactly the rule a booking is checked against (and re-checked under
    // the lock), so a sold, held or overdue gown is never shown as free.
    const blocked = await findRentalAvailabilityBlock(this.prisma, {
      tenantId,
      product,
      startDate,
      returnDate: endDate,
      bufferDays,
    });

    // Minimal by design — this answer is visible to anonymous callers.
    return { available: blocked === null };
  }

  /**
   * PUBLIC: the money terms a booking of this product would store right now
   * (rental-terms.ts, the same function create() uses). Same visibility as
   * getAvailability: only active, rental-eligible products of THIS tenant,
   * anything else is the same 404. Returns amounts only: no ids, no policy
   * internals. Read fresh on every call, so a changed shop default shows at
   * once. Display only: the booking re-computes and stores its own amount.
   */
  async getQuote(productId: string) {
    const tenantId = this.tenantContext.requireId;
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        isActive: true,
        deletedAt: null,
        availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
      },
      select: {
        rentalPricePerDay: true,
        basePrice: true,
        rentalDepositAmount: true,
        rentalDownPaymentPct: true,
        rentalDownPaymentMode: true,
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const policy = await this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
      select: { defaultDownPaymentPct: true },
    });
    return publicQuote(this.termsFor(product, policy, tenantId, productId));
  }

  /**
   * PUBLIC, shop-level: only whether the shop's default needs a down payment
   * at all (for the "How it works" step). No percentage, no other policy data.
   */
  async getTermsSummary() {
    const tenantId = this.tenantContext.requireId;
    const policy = await this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
      select: { defaultDownPaymentPct: true },
    });
    return { downPaymentRequired: shopDownPaymentPct(policy?.defaultDownPaymentPct) > 0 };
  }

  async getUpcomingPickups(days: number) {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);

    return this.prisma.rentalOrder.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        pickupDate: { gte: now, lte: future },
        status: {
          in: ['FULLY_PAID', 'READY_FOR_PICKUP'],
        },
      },
      orderBy: { pickupDate: 'asc' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateRentalDto) {
    const rental = await this.prisma.rentalOrder.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!rental) throw new NotFoundException('Rental order not found');

    const data: any = {};
    if (dto.pickupDate) data.pickupDate = new Date(dto.pickupDate);
    if (dto.pickupTime !== undefined) data.pickupTime = dto.pickupTime;
    if (dto.returnDate) data.returnDate = new Date(dto.returnDate);
    if (dto.weddingDate) data.weddingDate = new Date(dto.weddingDate);
    if (dto.weddingLocation !== undefined) data.weddingLocation = dto.weddingLocation;
    if (dto.weddingRegion !== undefined) data.weddingRegion = dto.weddingRegion;
    if (dto.deliveryModality !== undefined) data.deliveryModality = dto.deliveryModality;
    if (dto.shippingDate) data.shippingDate = new Date(dto.shippingDate);
    if (dto.shippingAddress !== undefined) data.shippingAddress = dto.shippingAddress;
    if (dto.transportMode !== undefined) data.transportMode = dto.transportMode;
    if (dto.transportReceiptUrl !== undefined) data.transportReceiptUrl = dto.transportReceiptUrl;
    if (dto.notes !== undefined) data.notes = dto.notes;

    const include = {
      product: { select: { id: true, name: true, slug: true } },
      variant: { select: { id: true, name: true } },
    };

    // A booking flagged NO_SHOW_REVIEW that staff reschedule to a live pickup day is back to normal.
    if (data.pickupDate && rental.holdState === 'NO_SHOW_REVIEW' && data.pickupDate.getTime() >= pickupCutoff(new Date()).getTime()) {
      data.holdState = null;
    }

    const datesChanged = data.returnDate !== undefined || data.pickupDate !== undefined;
    if (!datesChanged) {
      return this.prisma.rentalOrder.update({ where: { id }, data, include });
    }

    // Date edits go through the SAME authoritative availability check as
    // create(): validated, then re-checked inside a transaction serialized by
    // the per-product advisory lock, excluding this rental itself. Without it
    // an admin could extend a booking straight over another customer's dates
    // (or their 7-day buffer).
    const tenantId = this.tenantContext.requireId;
    if (NON_BLOCKING_RENTAL_STATUSES.includes(rental.status)) {
      throw new BadRequestException(`Cannot change dates on a ${rental.status} rental.`);
    }
    const startDate = rental.startDate;
    const returnDate: Date = data.returnDate ?? rental.returnDate;
    const pickupDate: Date = data.pickupDate ?? rental.pickupDate;
    if (startDate >= returnDate) {
      throw new BadRequestException('Return date must be after start date');
    }
    if (pickupDate > startDate) {
      throw new BadRequestException('Pickup date must be on or before start date');
    }

    const [product, policy] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: rental.productId, tenantId },
        select: { bufferDaysOverride: true },
      }),
      this.prisma.rentalPolicy.findFirst({ where: { tenantId } }),
    ]);
    const bufferDays = product?.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;
    const maxDuration = policy?.maxRentalDurationDays ?? 30;
    const rentalDays = Math.ceil(
      (returnDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (rentalDays > maxDuration) {
      throw new BadRequestException(`Rental duration exceeds maximum of ${maxDuration} days`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rental.productId}))`;
      // Same date-window rule as a booking (RETURNED / INSPECTION still hold
      // their window), excluding this rental. The gown is already committed
      // to this customer, so the sale / overdue rules are not re-applied.
      const availability = await findRentalAvailability(tx, {
        tenantId,
        product: { id: rental.productId, availabilityMode: 'RENTAL_ONLY' },
        startDate,
        returnDate,
        bufferDays,
        excludeRentalId: id,
        scope: 'reschedule',
        // M2: keep the booking's unit when it's still free on the new dates, else move to a free one.
        variantId: rental.variantId,
        currentUnitId: rental.rentalUnitId ?? null,
      });
      if (availability.block) {
        throw new ConflictException('Product is not available for the selected dates');
      }
      if (availability.unitId && availability.unitId !== rental.rentalUnitId) data.rentalUnitId = availability.unitId;
      return tx.rentalOrder.update({ where: { id }, data, include });
    });
  }

  async getPendingReturns() {
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    return this.prisma.rentalOrder.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        returnDate: { lte: threeDaysFromNow },
        status: { in: ['ACTIVE', 'ITEM_DISPATCHED'] },
      },
      orderBy: { returnDate: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  async getOverdueRentals() {
    const now = new Date();
    return this.prisma.rentalOrder.findMany({
      where: {
        tenantId: this.tenantContext.requireId,
        returnDate: { lt: now },
        status: 'ACTIVE',
      },
      orderBy: { returnDate: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  /** Customer-facing refusal for a booking (never another customer's details). */
  private bookingRefusal(reason: RentalBlockReason) {
    if (reason === 'NOT_RENTABLE_PRODUCT') {
      return new BadRequestException('Product is not available for rental');
    }
    if (reason === 'DATES_TAKEN' || reason === 'OVERDUE_RETURN') {
      return new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'NOT_AVAILABLE_FOR_DATES',
        reason,
        message: 'Product is not available for the selected dates',
      });
    }
    return notAvailableForRental(reason);
  }
}
