import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { conflictException } from '../common/offline-sync.util';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { UpdateRentalDto } from './dto/update-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { ownerScope } from '../auth/util/ownership';
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
import { customerIdState, hasApprovedId, lockCustomerIdState } from '../id-verification/id-approval';
import { decideHold, MAX_STAFF_EXTENSION_DAYS, pickupCutoff, pickupExpiryAt } from './rental-hold';
import { ExtendRentalHoldDto, RecordRentalRefundDto } from './dto/rental-hold-actions.dto';

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  async create(userId: string, dto: CreateRentalDto) {
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
    if (!user.email) {
      throw new BadRequestException(
        'Please add your email address to your profile before renting',
      );
    }
    if (user.addresses.length === 0) {
      throw new BadRequestException(
        'Please add an address to your profile before renting',
      );
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
    if (!variant || variant.productId !== dto.productId) {
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

    const available = await this.checkAvailability(
      dto.productId,
      startDate,
      returnDate,
      bufferDays,
    );
    if (!available) {
      throw new ConflictException(
        'Product is not available for the selected dates',
      );
    }

    // New pricing: flat rental price for the entire rental within maxRentalDays.
    // If returned within maxRentalDays → customer pays only the flat price.
    // If returned after maxRentalDays → customer pays flat price PLUS
    //   latePenaltyPercent% of flat price per day late.
    // The stored totalRentalPrice here is the flat price at booking time;
    //   any late fee is assessed on actual return in the rental controller.
    const rentalPrice = product.rentalPricePerDay
      ? Number(product.rentalPricePerDay)
      : Number(product.basePrice) * 0.1;
    const depositAmount = product.rentalDepositAmount
      ? Number(product.rentalDepositAmount)
      : 0;
    const downPaymentPct =
      product.rentalDownPaymentPct ??
      policy?.defaultDownPaymentPct ??
      25;

    const totalRentalPrice = rentalPrice;
    const downPaymentAmount = totalRentalPrice * (downPaymentPct / 100);

    const rentalNumber = `RNT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // The pre-check above (checkAvailability) is a fast fail for UX, but it and
    // the insert are two separate statements — two concurrent bookings for the
    // same gown over overlapping dates would both see overlapping===0 and both
    // get created, violating the single-item availability + 7-day buffer. Do
    // the authoritative check inside a transaction serialized by a per-product
    // advisory lock so only one booking for a given product runs at a time.
    const bufferMs = bufferDays * 24 * 60 * 60 * 1000;
    const bufferedStart = new Date(startDate.getTime() - bufferMs);
    const bufferedEnd = new Date(returnDate.getTime() + bufferMs);

    return this.prisma.$transaction(async (tx) => {
      // Advisory lock keyed by product id (auto-released at tx end). hashtext
      // maps the cuid to an int the lock function accepts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.productId}))`;

      const overlapping = await tx.rentalOrder.count({
        where: {
          tenantId,
          productId: dto.productId,
          status: { notIn: NON_BLOCKING_RENTAL_STATUSES },
          startDate: { lt: bufferedEnd },
          returnDate: { gt: bufferedStart },
        },
      });
      if (overlapping > 0) {
        throw new ConflictException(
          'Product is not available for the selected dates',
        );
      }

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
      // Money still held on a cancelled booking is flagged for refund
      // (REFUND_DUE) — never forfeited silently. Finance staff record the
      // payout (PATCH /rentals/:id/refund-recorded).
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

  /**
   * Finance staff record that the money held on a cancelled booking was paid
   * back: REFUND_DUE → REFUND_RECORDED, audited with amount / method /
   * reference / note. The amount can't exceed what is held. No Payment row is
   * created (a rental refund ledger is proposed with P0c), so reports keep
   * the collection until then.
   */
  async recordRefund(id: string, dto: RecordRentalRefundDto) {
    const tenantId = this.tenantContext.requireId;
    const rental = await this.prisma.rentalOrder.findFirst({ where: { id, tenantId } });
    if (!rental) throw new NotFoundException('Rental order not found');
    if (rental.status !== 'CANCELLED' || rental.holdState !== 'REFUND_DUE') {
      throw new BadRequestException('Only a cancelled booking marked REFUND_DUE can have its refund recorded.');
    }
    const held = await this.netPaid(id);
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (amount > held + 0.001) {
      throw new BadRequestException(`The refund (${amount}) is more than the ${held} TZS held on ${rental.rentalNumber}.`);
    }
    const res = await this.prisma.rentalOrder.updateMany({
      where: { id, tenantId, status: 'CANCELLED', holdState: 'REFUND_DUE' },
      data: { holdState: 'REFUND_RECORDED' },
    });
    if (res.count === 0) throw new ConflictException('The refund was already recorded. Reload.');
    await this.auditService.log('HOLD_REFUND_RECORDED', 'Rental', id, {
      amount,
      held,
      method: dto.method,
      reference: dto.reference?.trim() || null,
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
    const product = await this.prisma.product.findUnique({
      where: { id: productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const policy = await this.prisma.rentalPolicy.findFirst({
      where: { tenantId },
    });
    const bufferDays =
      product.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;

    const available = await this.checkAvailability(
      productId,
      startDate,
      endDate,
      bufferDays,
    );

    return { productId, startDate, endDate, available, bufferDays };
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
    const bufferMs = bufferDays * 24 * 60 * 60 * 1000;
    const bufferedStart = new Date(startDate.getTime() - bufferMs);
    const bufferedEnd = new Date(returnDate.getTime() + bufferMs);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rental.productId}))`;
      const overlapping = await tx.rentalOrder.count({
        where: {
          tenantId,
          productId: rental.productId,
          id: { not: id },
          status: { notIn: NON_BLOCKING_RENTAL_STATUSES },
          startDate: { lt: bufferedEnd },
          returnDate: { gt: bufferedStart },
        },
      });
      if (overlapping > 0) {
        throw new ConflictException('Product is not available for the selected dates');
      }
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

  private async checkAvailability(
    productId: string,
    startDate: Date,
    endDate: Date,
    bufferDays: number,
  ): Promise<boolean> {
    const bufferMs = bufferDays * 24 * 60 * 60 * 1000;
    const bufferedStart = new Date(startDate.getTime() - bufferMs);
    const bufferedEnd = new Date(endDate.getTime() + bufferMs);

    const overlapping = await this.prisma.rentalOrder.count({
      where: {
        tenantId: this.tenantContext.requireId,
        productId,
        status: { notIn: NON_BLOCKING_RENTAL_STATUSES },
        startDate: { lt: bufferedEnd },
        returnDate: { gt: bufferedStart },
      },
    });

    return overlapping === 0;
  }
}
