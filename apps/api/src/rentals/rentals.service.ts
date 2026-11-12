import {
  Injectable,
  Logger,
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
  assertRentalTransition,
  computeLateFee,
  resolveReturnedAt,
} from './rental-rules';
import { notAvailableForRental } from './rental-sale-guard';
import { findRentalAvailabilityBlock, RentalBlockReason } from './rental-availability';

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
    const query = { tenantId, product, startDate, returnDate, bufferDays };
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

    // Check ID verification status
    const idDoc = await this.prisma.customerIDDocument.findFirst({
      where: { userId, verificationStatus: 'APPROVED', tenantId },
    });
    const initialStatus = idDoc
      ? 'ID_VERIFIED'
      : 'PENDING_ID_VERIFICATION';

    const rentalNumber = `RNT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // The pre-check above and the insert are separate statements: a booking
    // or sale committed in between would be missed. So the authoritative
    // check runs again INSIDE the transaction, after the per-product advisory
    // lock that every booking and every sale path takes
    // (pg_advisory_xact_lock(hashtext(productId))). Only one of them runs
    // for a given gown at a time, and each sees what the previous committed.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.productId}))`;

      const blocked = await findRentalAvailabilityBlock(tx, query);
      if (blocked) throw this.bookingRefusal(blocked);

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

    const data: any = { status };
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
    await this.auditService.log('UPDATE_STATUS', 'Rental', id, { from: rental.status, to: status });
    return updated;
  }

  async markReadyForPickup(id: string) {
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    const marked = await this.prisma.rentalOrder.update({
      where: { id },
      data: { isReadyForPickup: true },
    });
    await this.auditService.log('MARK_READY', 'Rental', id);
    return marked;
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
      const blocked = await findRentalAvailabilityBlock(tx, {
        tenantId,
        product: { id: rental.productId, availabilityMode: 'RENTAL_ONLY' },
        startDate,
        returnDate,
        bufferDays,
        excludeRentalId: id,
        scope: 'reschedule',
      });
      if (blocked) {
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
