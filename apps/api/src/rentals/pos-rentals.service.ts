import { lateFeeSentence, storedLateFeeTerms } from './late-fee';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { RentalsService } from './rentals.service';
import { IdVerificationService } from '../id-verification/id-verification.service';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { findRentalAvailability, isRentableProduct } from './rental-availability';
import { rentalBalances, RENTAL_COMPONENTS, RentalComponent } from './rental-ledger';
import { hasApprovedId } from '../id-verification/id-approval';
import { userHasPermission } from '../auth/util/permission-check';
import {
  CONFIRM_MANUAL_PERMISSION,
  duplicateReferenceError,
  isNonCash,
  verifyTenders,
} from '../pos/payment-verification';

// ----------------------------------------------------------------- DTOs
export class PosRentalQuoteDto {
  @IsString() productId!: string;
  @IsString() variantId!: string;
  @IsDateString() startDate!: string;
  @IsDateString() returnDate!: string;
  @IsDateString() pickupDate!: string;
}

export class PosCustomerDto {
  @IsString() @MaxLength(80) firstName!: string;
  @IsString() @MaxLength(80) lastName!: string;
  /** Tanzanian phone, digits with optional +. Unique per shop. */
  @IsString() @Matches(/^\+?[0-9]{9,15}$/, { message: 'phone: 9–15 digits, optional +' }) phone!: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) region?: string;
}

export class PosAddressDto {
  @IsString() @MaxLength(200) street!: string;
  @IsString() @MaxLength(80) city!: string;
  @IsString() @MaxLength(80) region!: string;
}

export class PosCreateRentalDto extends PosRentalQuoteDto {
  @IsString() customerId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** The customer read and accepted the rental agreement terms. */
  @IsBoolean() termsAccepted!: boolean;
}

export class PosIdInPersonDto {
  @IsIn(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID']) idType!: string;
  @IsString() @Matches(/^[A-Za-z0-9-]{5,40}$/, { message: 'idNumber: 5–40 letters, digits or dashes' }) idNumber!: string;
}

export class PosTenderDto {
  @IsString() method!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000_000) amount!: number;
  @IsOptional() @IsString() @MaxLength(64) transactionRef?: string;
  @IsOptional() @IsString() @MaxLength(12) approvalCode?: string;
}

export class PosRentalPaymentDto {
  @IsIn(RENTAL_COMPONENTS as unknown as string[]) component!: RentalComponent;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => PosTenderDto) tenders!: PosTenderDto[];
  /** Cash goes into the cashier's OPEN shift drawer. */
  @IsOptional() @IsString() @MaxLength(40) sessionId?: string;
}

export class PosHandoverDto {
  /** Scanned / typed unit tag; must match the allocated unit (unit-managed products). */
  @IsOptional() @IsString() @MaxLength(40) unitCode?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export const RETURN_CONDITIONS = ['GOOD', 'MINOR_DAMAGE', 'DAMAGED', 'MISSING_PARTS'] as const;
export class PosReturnDto {
  @IsIn(RETURN_CONDITIONS as unknown as string[]) condition!: (typeof RETURN_CONDITIONS)[number];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** After a damaged return, take the unit out of service. */
  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE']) unitStatus?: 'ACTIVE' | 'MAINTENANCE';
}

/** Version of the agreement text the customer accepts (printed on the agreement). */
export const RENTAL_AGREEMENT_VERSION = 'NARO-RENTAL-AGREEMENT-2026-11';
const AGREEMENT_TERMS = [
  'The booking is confirmed once the National ID is approved and any required down payment is received.',
  'The full rental fee and the full refundable deposit are paid before the item is handed over.',
  'The deposit is returned after the item is returned and inspected. A deduction for damage is made only with a written reason and a second approval.',
  'Late return: the late fee is charged per day after the booked return date, as shown in the amounts.',
  'Cancellations and refunds are reviewed and approved by the shop; no money is kept or paid back automatically.',
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Walk-in POS rentals (POS rental MVP, M3). Thin orchestration over the SAME
 * rules the online flow uses: RentalsService.create (availability incl.
 * units, locks, ID rule, hold, money terms), the rental money ledger, P0c
 * payment verification, the #16 ID approval, and the handover gate. Kept
 * separate from POS sales and layaways (own routes, own Payment component).
 * Every mutation needs an online API call: nothing here is offline-queued.
 */
@Injectable()
export class PosRentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly rentals: RentalsService,
    private readonly idVerification: IdVerificationService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  private get tenantId() {
    return this.tenantContext.requireId;
  }

  // ------------------------------------------------------------ catalog
  async catalog(q?: string) {
    const term = (q ?? '').trim();
    const products = await this.prisma.product.findMany({
      where: {
        tenantId: this.tenantId,
        isActive: true,
        deletedAt: null,
        archivedAt: null,
        availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { variants: { some: { OR: [{ sku: { contains: term, mode: 'insensitive' } }, { barcode: term }] } } },
                { rentalUnits: { some: { code: term } } },
              ],
            }
          : {}),
      },
      select: {
        id: true, name: true, slug: true, availabilityMode: true, rentalPricePerDay: true, rentalDepositAmount: true,
        variants: { where: { isActive: true }, select: { id: true, name: true, sku: true } },
        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        _count: { select: { rentalUnits: true } },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return products.map((p) => ({ ...p, unitCount: p._count.rentalUnits }));
  }

  // ------------------------------------------------------------ quote
  async quote(dto: PosRentalQuoteDto) {
    const tenantId = this.tenantId;
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId } });
    if (!product || !isRentableProduct(product)) throw new BadRequestException('This item is not available for rental.');
    const variant = await this.prisma.productVariant.findFirst({ where: { id: dto.variantId, productId: product.id, tenantId, isActive: true } });
    if (!variant) throw new BadRequestException('Choose a size of this item.');
    const policy = await this.prisma.rentalPolicy.findFirst({ where: { tenantId } });
    const bufferDays = product.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;
    const startDate = new Date(dto.startDate);
    const returnDate = new Date(dto.returnDate);
    const availability = await findRentalAvailability(this.prisma, {
      tenantId, product, startDate, returnDate, bufferDays, variantId: variant.id,
    });
    const terms: any = await this.rentals.getQuote(product.id);
    // LF-2026-11: the same terms the booking will store (rentals.getQuote → late-fee.ts).
    const lateFeePerDay = terms.lateFee ? Number(terms.lateFee.perDay) : 0;
    return {
      available: !availability.block,
      reason: availability.block,
      unitManaged: availability.mode === 'UNITS',
      ...terms,
      lateFeePerDay,
      balanceAfterDownPayment: round2(Number(terms.rentalFee ?? 0) - Number(terms.downPayment ?? 0)),
      dueBeforeHandover: round2(Number(terms.rentalFee ?? 0) + Number(terms.deposit ?? 0)),
    };
  }

  // ------------------------------------------------------------ customers
  async findCustomers(q: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        tenantId: this.tenantId,
        OR: [
          { phone: { contains: term.replace(/\s+/g, '') } },
          { email: { contains: term, mode: 'insensitive' } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, isActive: true, _count: { select: { addresses: true } } },
      take: 20,
    });
  }

  /** Register a walk-in customer: name + phone required, email optional, address optional (needed before handover). */
  async createCustomer(dto: PosCustomerDto, actor: { id: string }) {
    const tenantId = this.tenantId;
    const phone = dto.phone.replace(/\s+/g, '');
    const email = dto.email?.trim().toLowerCase() || null;
    const clash = await this.prisma.user.findFirst({
      where: { tenantId, OR: [{ phone }, ...(email ? [{ email }] : [])] },
      select: { id: true },
    });
    if (clash) throw new ConflictException({ statusCode: 409, code: 'CUSTOMER_EXISTS', customerId: clash.id, message: 'A customer with this phone or email already exists. Select them instead.' });
    const hasAddress = !!(dto.street && dto.city && dto.region);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone,
        email,
        isActive: true,
        ...(hasAddress
          ? { addresses: { create: { fullName: `${dto.firstName} ${dto.lastName}`.trim(), phone, street: dto.street!, city: dto.city!, region: dto.region!, isDefault: true } } }
          : {}),
      },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });
    await this.audit.log('POS_CUSTOMER_CREATED', 'User', user.id, { byAdminId: actor.id, hasEmail: !!email, hasAddress });
    return user;
  }

  async addAddress(customerId: string, dto: PosAddressDto) {
    const user = await this.prisma.user.findFirst({ where: { id: customerId, tenantId: this.tenantId }, select: { id: true, firstName: true, lastName: true, phone: true } });
    if (!user) throw new NotFoundException('Customer not found');
    const a = await this.prisma.address.create({
      data: { userId: user.id, fullName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Customer', phone: user.phone ?? '', street: dto.street, city: dto.city, region: dto.region, isDefault: true },
    });
    await this.audit.log('POS_CUSTOMER_ADDRESS_ADDED', 'User', user.id, { addressId: a.id });
    return a;
  }

  // ------------------------------------------------------------ booking
  async create(dto: PosCreateRentalDto, actor: { id: string }) {
    const customer = await this.prisma.user.findFirst({ where: { id: dto.customerId, tenantId: this.tenantId }, select: { id: true, isActive: true } });
    if (!customer || customer.isActive === false) throw new BadRequestException('Select an active customer.');
    const rental = await this.rentals.create(
      customer.id,
      { productId: dto.productId, variantId: dto.variantId, startDate: dto.startDate, returnDate: dto.returnDate, pickupDate: dto.pickupDate, notes: dto.notes } as any,
      { channel: 'POS', createdByAdminId: actor.id, termsAccepted: dto.termsAccepted },
    );
    await this.audit.log('RENTAL_CREATED', 'Rental', rental.id, {
      channel: 'POS', rentalNumber: rental.rentalNumber, unitId: (rental as any).rentalUnitId ?? null, agreementVersion: RENTAL_AGREEMENT_VERSION,
    });
    return this.detail(rental.id);
  }

  private async load(id: string) {
    const r = await this.prisma.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, addresses: { take: 1, orderBy: { isDefault: 'desc' } } } },
        product: { select: { id: true, name: true, latePenaltyPercent: true } },
        variant: { select: { id: true, name: true, sku: true } },
        rentalUnit: { select: { id: true, code: true, label: true, status: true } },
        payments: { orderBy: { createdAt: 'asc' } },
        refundRequests: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException('Rental not found');
    return r;
  }

  async detail(id: string) {
    const r = await this.load(id);
    const b = rentalBalances(r, r.payments, r.refundRequests);
    const idApproved = await hasApprovedId(this.prisma, this.tenantId, r.userId);
    return {
      ...r,
      idApproved,
      ledger: b,
      handoverReady: idApproved && b.feeFullyPaid && b.depositFullyPaid && r.user.addresses.length > 0,
    };
  }

  /** Resume after an interruption: find a booking by its reference. */
  async lookup(rentalNumber: string) {
    const r = await this.prisma.rentalOrder.findFirst({ where: { tenantId: this.tenantId, rentalNumber: rentalNumber.trim().toUpperCase() }, select: { id: true } });
    if (!r) throw new NotFoundException('No rental with that reference.');
    return this.detail(r.id);
  }

  // ------------------------------------------------------------ ID in person
  /**
   * Staff saw the customer's original ID document in person (needs
   * id-verification:review + 2FA guard on the route). Records the document
   * (number only, no image: marker in-person://) and approves it through the
   * SAME approval as the online queue, so waiting bookings are reconciled.
   */
  async verifyIdInPerson(rentalId: string, dto: PosIdInPersonDto, actor: { id: string }) {
    const r = await this.load(rentalId);
    if (await hasApprovedId(this.prisma, this.tenantId, r.userId)) return { alreadyApproved: true, ...(await this.detail(rentalId)) };
    const pending = await this.prisma.customerIDDocument.findFirst({ where: { tenantId: this.tenantId, userId: r.userId, verificationStatus: 'PENDING' }, select: { id: true } });
    const docId =
      pending?.id ??
      (
        await this.prisma.customerIDDocument.create({
          data: {
            tenantId: this.tenantId, userId: r.userId, idType: dto.idType, idNumber: dto.idNumber,
            frontImageUrl: `in-person://${actor.id}`, verificationStatus: 'PENDING',
          },
          select: { id: true },
        })
      ).id;
    await this.audit.log('ID_VERIFIED_IN_PERSON', 'CustomerIDDocument', docId, { rentalId, idType: dto.idType });
    await this.idVerification.approve(docId);
    return this.detail(rentalId);
  }

  // ------------------------------------------------------------ payments
  /**
   * Record a walk-in rental payment for ONE component (fee, deposit, late fee).
   * Cash needs the cashier's open shift (counts in the drawer); card / mobile
   * money need P0c evidence + payments:confirm-manual. Never collects more
   * than is still due for the component. Serialized per rental with the same
   * lock payment initiation takes; one transaction; settlement roll-up after.
   */
  async recordPayment(rentalId: string, dto: PosRentalPaymentDto, actor: any) {
    const tenantId = this.tenantId;
    const nonCash = dto.tenders.some((t) => isNonCash(t.method));
    const canConfirmManually = nonCash ? await userHasPermission(this.prisma as any, actor, CONFIRM_MANUAL_PERMISSION) : false;
    const verified = verifyTenders(dto.tenders as any, { canConfirmManually, actorAdminId: actor.id });
    const hasCash = dto.tenders.some((t) => !isNonCash(t.method));
    // Cash needs the cashier's own OPEN shift. Non-cash money is tagged with
    // that shift too when one is given (R4 reconciliation itemises it); it
    // never changes the drawer's expected cash, which counts CASH only.
    let sessionId: string | null = null;
    if (hasCash || dto.sessionId) {
      const s = await this.prisma.posSession.findFirst({ where: { id: dto.sessionId ?? '', tenantId, adminUserId: actor.id, status: 'OPEN' }, select: { id: true } });
      if (!s && hasCash) throw new BadRequestException('Cash needs your OPEN POS shift (sessionId). Open a shift first.');
      sessionId = s?.id ?? null;
    }
    const refs = verified.map((v) => v.transactionRef).filter(Boolean) as string[];
    if (refs.length) {
      const dup = await this.prisma.payment.findFirst({ where: { tenantId, transactionRef: { in: refs } }, select: { transactionRef: true } });
      if (dup?.transactionRef) throw duplicateReferenceError([dup.transactionRef]);
    }
    const total = round2(dto.tenders.reduce((s, t) => s + Number(t.amount), 0));

    let created: any[] = [];
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const key = `payment:rental:${rentalId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const r = await tx.rentalOrder.findFirst({ where: { id: rentalId, tenantId }, include: { payments: true, refundRequests: true } });
        if (!r) throw new NotFoundException('Rental not found');
        if (['CANCELLED', 'CLOSED', 'REJECTED', 'ID_REJECTED'].includes(r.status)) {
          throw new BadRequestException(`This booking is ${r.status}; no payment can be taken.`);
        }
        const due = rentalBalances(r, r.payments, r.refundRequests).outstanding[dto.component];
        if (total > due + 0.001) {
          throw new BadRequestException(`Only ${due} TZS of ${dto.component} is still due on ${r.rentalNumber}.`);
        }
        const rows: any[] = [];
        for (let i = 0; i < dto.tenders.length; i++) {
          const t = dto.tenders[i];
          const v = verified[i];
          rows.push(
            await tx.payment.create({
              data: {
                tenantId,
                rentalOrderId: r.id,
                amount: round2(Number(t.amount)),
                method: String(t.method).toUpperCase(),
                status: 'COMPLETED',
                component: dto.component,
                transactionRef: v.transactionRef,
                gatewayResponse: {
                  kind: 'POS_RENTAL_PAYMENT',
                  recordedByAdminId: actor.id,
                  ...(sessionId ? { posSessionId: sessionId } : {}),
                  ...(v.verification ? { verification: v.verification as any } : {}),
                },
              },
            }),
          );
        }
        return rows;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw duplicateReferenceError(['(reference already used)']);
      throw e;
    }
    for (const p of created) {
      await this.audit.log('RENTAL_PAYMENT_RECORDED', 'Payment', p.id, { rentalId, component: dto.component, method: p.method, amount: Number(p.amount) });
      if ((p.gatewayResponse as any)?.verification) {
        await this.audit.log('PAYMENT_MANUALLY_CONFIRMED', 'Payment', p.id, { rentalId, method: p.method, reference: p.transactionRef, providerVerified: false });
      }
    }
    await this.settlement.updateRentalPaymentStatus(rentalId, tenantId);
    return this.detail(rentalId);
  }

  // ------------------------------------------------------------ agreement & receipt
  async agreement(id: string) {
    const r = await this.detail(id);
    const addr = r.user.addresses[0];
    return {
      title: 'Rental agreement',
      agreementVersion: RENTAL_AGREEMENT_VERSION,
      rentalNumber: r.rentalNumber,
      createdAt: r.createdAt,
      termsAcceptedAt: r.termsAcceptedAt,
      channel: r.channel,
      customer: {
        name: `${r.user.firstName ?? ''} ${r.user.lastName ?? ''}`.trim(),
        phone: r.user.phone,
        email: r.user.email,
        address: addr ? `${addr.street}, ${addr.city}, ${addr.region}` : null,
        nationalIdApproved: r.idApproved, // never the ID number
      },
      item: { product: r.product.name, size: r.variant.name, unit: r.rentalUnit?.code ?? null },
      dates: { pickupDate: r.pickupDate, startDate: r.startDate, returnDate: r.returnDate },
      amounts: {
        rentalFee: Number(r.totalRentalPrice),
        downPayment: Number(r.downPaymentAmount),
        refundableDeposit: Number(r.damageDeposit),
        lateFeePercentPerDay: storedLateFeeTerms((r as any).lateFeeTerms)?.pct ?? (r.product.latePenaltyPercent != null ? Number(r.product.latePenaltyPercent) : null),
        // LF-2026-11: the late-fee terms agreed at booking + the sentence printed (EN / SW).
        lateFee: storedLateFeeTerms((r as any).lateFeeTerms),
        lateFeeText: storedLateFeeTerms((r as any).lateFeeTerms)
          ? { en: lateFeeSentence(storedLateFeeTerms((r as any).lateFeeTerms)!, 'en'), sw: lateFeeSentence(storedLateFeeTerms((r as any).lateFeeTerms)!, 'sw') }
          : null,
        paid: r.ledger.collected,
        outstanding: r.ledger.outstanding,
      },
      terms: AGREEMENT_TERMS,
      status: r.status,
    };
  }

  async receipt(rentalId: string, paymentId: string) {
    const r = await this.load(rentalId);
    const p = r.payments.find((x) => x.id === paymentId);
    if (!p) throw new NotFoundException('Payment not found on this rental');
    const b = rentalBalances(r, r.payments, r.refundRequests);
    return {
      title: p.status === 'REFUNDED' ? 'Refund receipt' : 'Payment receipt',
      rentalNumber: r.rentalNumber,
      paymentId: p.id,
      at: p.createdAt,
      component: p.component,
      method: p.method,
      amount: Number(p.amount),
      reference: p.transactionRef,
      manuallyConfirmed: !!(p.gatewayResponse as any)?.verification,
      customer: `${r.user.firstName ?? ''} ${r.user.lastName ?? ''}`.trim(),
      item: `${r.product.name} (${r.variant.name})`,
      balancesAfter: { collected: b.collected, outstanding: b.outstanding },
    };
  }

  // ------------------------------------------------------------ handover & return
  async handover(id: string, dto: PosHandoverDto, actor: any) {
    const r = await this.load(id);
    if (r.rentalUnit) {
      if (!dto.unitCode || dto.unitCode.trim() !== r.rentalUnit.code) {
        throw new BadRequestException({ statusCode: 400, code: 'UNIT_MISMATCH', message: `Scan the allocated unit (${r.rentalUnit.code}) to hand it over.` });
      }
    }
    // The gate (ID, full fee, deposit, address, unit) + rentals:release run inside updateStatus.
    const updated = await this.rentals.updateStatus(id, 'ACTIVE', r.status, actor);
    await this.prisma.rentalOrder.updateMany({
      where: { id, tenantId: this.tenantId, status: 'ACTIVE' },
      data: { handedOverAt: new Date(), handedOverByAdminId: actor.id },
    });
    await this.audit.log('RENTAL_RELEASED', 'Rental', id, { unit: r.rentalUnit?.code ?? null, notes: dto.notes });
    return { ...updated, ...(await this.detail(id)) };
  }

  async recordReturn(id: string, dto: PosReturnDto, actor: any) {
    const r = await this.load(id);
    if (!['ITEM_DISPATCHED', 'ACTIVE'].includes(r.status)) {
      throw new BadRequestException(`Only an item that is out with the customer can be returned (status ${r.status}).`);
    }
    // RETURNED computes the late fee from the booked return date (existing rule).
    await this.rentals.updateStatus(id, 'RETURNED', r.status, actor);
    await this.prisma.rentalOrder.updateMany({
      where: { id, tenantId: this.tenantId, status: 'RETURNED' },
      data: { returnCondition: dto.condition, returnNotes: dto.notes ?? null, returnedByAdminId: actor.id },
    });
    if (r.rentalUnit) {
      await this.prisma.rentalUnit.updateMany({
        where: { id: r.rentalUnit.id, tenantId: this.tenantId },
        data: {
          conditionNotes: [dto.condition, dto.notes].filter(Boolean).join(': '),
          ...(dto.unitStatus ? { status: dto.unitStatus } : {}),
        },
      });
    }
    await this.audit.log('RENTAL_RETURN_RECORDED', 'Rental', id, { condition: dto.condition, unitStatus: dto.unitStatus ?? null });
    return this.detail(id);
  }

}
