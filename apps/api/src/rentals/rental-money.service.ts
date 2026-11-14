import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { claimsOverpayment, overpaymentRefundableNow, refundableNow, rentalBalances, RENTAL_COMPONENTS } from './rental-ledger';
import { normalizeReference } from '../pos/payment-verification';

export const REFUND_KINDS = ['CANCELLATION', 'DEPOSIT_RETURN', 'OVERPAYMENT'] as const;
export const REFUND_PAYOUT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER'] as const;

export class CreateRentalRefundRequestDto {
  @IsIn(REFUND_KINDS as unknown as string[]) kind!: (typeof REFUND_KINDS)[number];
  @IsIn(RENTAL_COMPONENTS as unknown as string[]) component!: (typeof RENTAL_COMPONENTS)[number];
  /** Paid back to the customer. */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) amount!: number;
  /** DEPOSIT_RETURN only: part of the deposit kept for documented damage. */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) retainedAmount?: number;
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class RejectRentalRefundDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class PayRentalRefundDto {
  @IsIn(REFUND_PAYOUT_METHODS as unknown as string[]) method!: (typeof REFUND_PAYOUT_METHODS)[number];
  /** Mobile money / bank: the payout reference (required, unique). Cash: optional receipt no. */
  @IsOptional() @IsString() @MaxLength(64) reference?: string;
  /** Cash payouts come out of the paying cashier's OPEN shift drawer. */
  @IsOptional() @IsString() @MaxLength(40) sessionId?: string;
}

/** LF-2026-11: waiving part or all of a late fee (reason + a different approver). */
export class RequestLateFeeWaiverDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000_000) amount!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class DecideLateFeeWaiverDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class FailRentalRefundDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rental money: the ledger view and the refund workflow (POS rental MVP, M1).
 *
 *   request (rentals:refund-request) → approve (refunds:approve, a DIFFERENT
 *   admin) → pay (payments:manage: records the manual payout) → or reject /
 *   fail (payout bounced → the liability comes back).
 *
 * Money rules (all under the per-rental lock `refund:rental:<id>`):
 *  - a request can claim at most what is HELD for its component minus what
 *    other open requests already claim (partial refunds allowed, never more);
 *  - a payout is a NEW Payment row (REFUNDED, positive, `component`,
 *    `refundOfPaymentId` = the collection it pays back, `refundRequestId`),
 *    never an edit of the collection row; the payout reference is unique;
 *  - nothing is ever paid out or kept automatically.
 */
@Injectable()
export class RentalMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  private async loadRental(db: any, id: string) {
    const tenantId = this.tenantContext.requireId;
    const rental = await db.rentalOrder.findFirst({ where: { id, tenantId } });
    if (!rental) throw new NotFoundException('Rental order not found');
    return rental;
  }

  private async state(db: any, rentalOrderId: string) {
    const tenantId = this.tenantContext.requireId;
    const [rental, payments, requests] = await Promise.all([
      this.loadRental(db, rentalOrderId),
      db.payment.findMany({
        where: { rentalOrderId, tenantId },
        select: { id: true, amount: true, status: true, component: true, method: true, createdAt: true, refundOfPaymentId: true, transactionRef: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.refundRequest.findMany({ where: { rentalOrderId, tenantId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { rental, payments, requests, balances: rentalBalances(rental, payments, requests) };
  }

  /** GET /rentals/:id/ledger — what is due, received, refunded, kept and held. */
  async ledger(rentalOrderId: string) {
    const { rental, payments, requests, balances } = await this.state(this.prisma, rentalOrderId);
    return {
      rentalId: rental.id,
      rentalNumber: rental.rentalNumber,
      status: rental.status,
      holdState: rental.holdState,
      downPaymentAmount: Number(rental.downPaymentAmount),
      ...balances,
      payments: payments.map((p: any) => ({ ...p, amount: Number(p.amount) })),
      refundRequests: requests.map((r: any) => ({ ...r, amount: Number(r.amount), retainedAmount: Number(r.retainedAmount) })),
    };
  }

  private async lock(tx: any, rentalOrderId: string) {
    const key = `refund:rental:${rentalOrderId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  async createRequest(rentalOrderId: string, dto: CreateRentalRefundRequestDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const amount = round2(Number(dto.amount));
    const retained = round2(Number(dto.retainedAmount ?? 0));
    if (dto.kind !== 'DEPOSIT_RETURN' && retained > 0) {
      throw new BadRequestException('Only a deposit return can retain part of the deposit.');
    }
    if (dto.kind === 'DEPOSIT_RETURN' && dto.component !== 'DEPOSIT') {
      throw new BadRequestException('A deposit return is for the DEPOSIT component.');
    }
    if (amount + retained <= 0) throw new BadRequestException('Nothing to refund or retain.');

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, rentalOrderId);
      const { rental, requests, balances } = await this.state(tx, rentalOrderId);
      if (dto.kind === 'CANCELLATION' && rental.status !== 'CANCELLED') {
        throw new BadRequestException('A cancellation refund needs a CANCELLED booking. Cancel it first.');
      }
      if (dto.kind === 'DEPOSIT_RETURN' && !['RETURNED', 'INSPECTION', 'CLOSED', 'CANCELLED'].includes(rental.status)) {
        throw new BadRequestException('The deposit is settled after the item is returned (RETURNED / INSPECTION / CLOSED).');
      }
      const room = dto.kind === 'OVERPAYMENT' ? overpaymentRefundableNow(balances, requests) : refundableNow(balances, dto.component, requests);
      if (amount + retained > room + 0.001) {
        throw new BadRequestException(
          `The request (${amount + retained} TZS) is more than the ${room} TZS of ${dto.component} still held and not already claimed on ${rental.rentalNumber}.`,
        );
      }
      return tx.refundRequest.create({
        data: {
          tenantId,
          rentalOrderId,
          kind: dto.kind,
          component: dto.component,
          amount,
          retainedAmount: retained,
          reason: dto.reason,
          requestedById: actor.id,
        },
      });
    });
    await this.audit.log('REFUND_REQUESTED', 'RefundRequest', created.id, {
      rentalOrderId, kind: dto.kind, component: dto.component, amount, retainedAmount: retained,
    });
    return created;
  }

  private async loadRequest(id: string) {
    // /rental-money acts on RENTAL requests only; order / POS / layaway
    // requests share the table but go through /refund-requests.
    const r = await this.prisma.refundRequest.findFirst({ where: { id, tenantId: this.tenantContext.requireId, subject: 'RENTAL' } });
    if (!r || !r.rentalOrderId) throw new NotFoundException('Refund request not found');
    return r as typeof r & { rentalOrderId: string; component: string };
  }

  /** Four-eyes: the approver must not be the requester. */
  async approve(id: string, actor: { id: string }) {
    const r = await this.loadRequest(id);
    if (r.requestedById === actor.id) {
      await this.audit.log('REFUND_APPROVAL_DENIED', 'RefundRequest', id, { reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'A refund must be approved by a different person than the one who requested it.' });
    }
    const res = await this.prisma.refundRequest.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: 'REQUESTED' },
      data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('The request is no longer waiting for approval. Reload.');
    await this.audit.log('REFUND_APPROVED', 'RefundRequest', id, { amount: Number(r.amount), retainedAmount: Number(r.retainedAmount) });
    return this.loadRequest(id);
  }

  async reject(id: string, dto: RejectRentalRefundDto, actor: { id: string }) {
    const res = await this.prisma.refundRequest.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: { in: ['REQUESTED', 'APPROVED'] } },
      data: { status: 'REJECTED', rejectedById: actor.id, rejectionReason: dto.reason },
    });
    if (res.count === 0) throw new ConflictException('The request can no longer be rejected (paid or already closed).');
    await this.audit.log('REFUND_REJECTED', 'RefundRequest', id, { reason: dto.reason });
    return this.loadRequest(id);
  }

  /**
   * Record the manual payout of an APPROVED request. Re-checks the cap under
   * the lock, writes ONE REFUNDED Payment row linked to its source collection
   * (none for a retain-only request), and marks the request PAID — all in one
   * transaction. Cash comes out of the paying cashier's open shift.
   */
  async pay(id: string, dto: PayRentalRefundDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const req = await this.loadRequest(id);
    // Separation of duties: whoever asked for the refund never hands the
    // money out. (The approver may pay out: with one owner a three-person
    // rule would make every payout impossible.)
    if (req.requestedById === actor.id) {
      await this.audit.log('REFUND_PAYOUT_DENIED', 'RefundRequest', id, { reason: 'PAYOUT_BY_REQUESTER' });
      throw new ForbiddenException({ statusCode: 403, code: 'PAYOUT_BY_REQUESTER', message: 'The person who requested a refund cannot also pay it out.' });
    }
    const reference = dto.reference ? normalizeReference(dto.reference) : null;
    if (dto.method !== 'CASH' && Number(req.amount) > 0 && !reference) {
      throw new BadRequestException('Mobile-money and bank payouts need the payout reference (4–64 letters/digits).');
    }
    let sessionId: string | null = null;
    if (dto.method === 'CASH' && Number(req.amount) > 0) {
      const session = await this.prisma.posSession.findFirst({
        where: { id: dto.sessionId ?? '', tenantId, adminUserId: actor.id, status: 'OPEN' },
        select: { id: true },
      });
      if (!session) throw new BadRequestException('A cash payout needs your OPEN POS shift (sessionId).');
      sessionId = session.id;
    }

    let payout: any = null;
    try {
      payout = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, req.rentalOrderId);
        const fresh = await tx.refundRequest.findFirst({ where: { id, tenantId, subject: 'RENTAL' } });
        if (!fresh || fresh.status !== 'APPROVED') throw new ConflictException('Only an APPROVED request can be paid. Reload.');
        const { rental, payments, requests, balances } = await this.state(tx, req.rentalOrderId);
        const others = requests.filter((r: any) => r.id !== id);
        const room =
          claimsOverpayment(fresh) ? overpaymentRefundableNow(balances, others) : refundableNow(balances, fresh.component as any, others);
        const total = Number(fresh.amount) + Number(fresh.retainedAmount);
        if (total > room + 0.001) {
          throw new ConflictException(`Only ${room} TZS of ${fresh.component} is still held on ${rental.rentalNumber}; nothing paid.`);
        }
        let row: any = null;
        if (Number(fresh.amount) > 0) {
          // Pay back the most recent collection of this component (or an unallocated one).
          // An overpayment refund pays back surplus (unallocated) money: the
          // payout row carries no component, so the ledger takes it off the
          // overpaid amount first, never off the fee / deposit held.
          const surplus = claimsOverpayment(fresh);
          const source = [...payments].reverse().find(
            (p: any) => p.status === 'COMPLETED' && (surplus ? p.component == null : p.component === fresh.component || p.component == null),
          );
          row = await tx.payment.create({
            data: {
              tenantId,
              rentalOrderId: rental.id,
              amount: Number(fresh.amount),
              method: dto.method,
              status: 'REFUNDED',
              component: surplus ? null : fresh.component,
              refundOfPaymentId: source?.id ?? null,
              refundRequestId: id,
              transactionRef: reference,
              gatewayResponse: {
                kind: 'RENTAL_REFUND',
                refundRequestId: id,
                refundKind: fresh.kind,
                paidByAdminId: actor.id,
                ...(sessionId ? { posSessionId: sessionId } : {}),
              },
            },
          });
        }
        const claim = await tx.refundRequest.updateMany({
          where: { id, tenantId, status: 'APPROVED' },
          data: { status: 'PAID', paidById: actor.id, paidAt: new Date(), payoutMethod: dto.method, payoutReference: reference },
        });
        if (claim.count === 0) throw new ConflictException('The request changed meanwhile; nothing paid.');
        // A cancelled booking whose money is fully paid back is settled.
        const after = rentalBalances(rental, row ? [...payments, row] : payments, [
          ...others,
          { ...fresh, status: 'PAID' },
        ]);
        if (rental.status === 'CANCELLED' && rental.holdState === 'REFUND_DUE' && after.totalHeld <= 0.001) {
          await tx.rentalOrder.updateMany({
            where: { id: rental.id, tenantId, status: 'CANCELLED', holdState: 'REFUND_DUE' },
            data: { holdState: 'REFUND_SETTLED' },
          });
        }
        return row;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('That payout reference has already been used.');
      throw e;
    }
    await this.audit.log('REFUND_PAID', 'RefundRequest', id, {
      paymentId: payout?.id ?? null, method: dto.method, reference, amount: Number(req.amount), retainedAmount: Number(req.retainedAmount),
    });
    return this.loadRequest(id);
  }

  /**
   * The payout failed or bounced after it was recorded: the refund row becomes
   * REVERSED (no longer money paid back) and the request FAILED, so the
   * liability is held again and a new request can be made.
   */
  async fail(id: string, dto: FailRentalRefundDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const req = await this.loadRequest(id);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, req.rentalOrderId);
      const res = await tx.refundRequest.updateMany({
        where: { id, tenantId, status: 'PAID' },
        data: { status: 'FAILED', failedById: actor.id, failedAt: new Date(), failureReason: dto.reason },
      });
      if (res.count === 0) throw new ConflictException('Only a PAID request can be marked failed.');
      await tx.payment.updateMany({
        where: { tenantId, refundRequestId: id, status: 'REFUNDED' },
        data: { status: 'REVERSED' },
      });
      await tx.rentalOrder.updateMany({
        where: { id: req.rentalOrderId, tenantId, status: 'CANCELLED', holdState: 'REFUND_SETTLED' },
        data: { holdState: 'REFUND_DUE' },
      });
    });
    await this.audit.log('REFUND_FAILED', 'RefundRequest', id, { reason: dto.reason });
    return this.loadRequest(id);
  }

  async listRequests(status?: string) {
    return this.prisma.refundRequest.findMany({
      where: { tenantId: this.tenantContext.requireId, subject: 'RENTAL', ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { rentalOrder: { select: { rentalNumber: true, status: true, holdState: true } } },
    });
  }

  // ------------------------------------------------------------ late-fee waivers (LF-2026-11)
  /** Late fee still waivable: charged − already waived − open waiver requests. */
  private async waivable(db: any, rental: any) {
    const open = await db.rentalLateFeeWaiver.aggregate({
      where: { tenantId: this.tenantContext.requireId, rentalOrderId: rental.id, status: 'REQUESTED' },
      _sum: { amount: true },
    });
    return round2(Number(rental.lateFee ?? 0) - Number(rental.lateFeeWaived ?? 0) - Number(open._sum.amount ?? 0));
  }

  async requestLateFeeWaiver(rentalOrderId: string, dto: RequestLateFeeWaiverDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const w = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, rentalOrderId);
      const rental = await this.loadRental(tx, rentalOrderId);
      const room = await this.waivable(tx, rental);
      if (!(Number(rental.lateFee) > 0)) throw new BadRequestException('There is no late fee on this rental to waive.');
      if (dto.amount > room + 0.001) throw new BadRequestException(`Only ${Math.max(0, room)} TZS of the late fee can still be waived.`);
      return tx.rentalLateFeeWaiver.create({
        data: { tenantId, rentalOrderId, amount: dto.amount, reason: dto.reason.trim(), status: 'REQUESTED', requestedById: actor.id },
      });
    });
    await this.audit.log('LATE_FEE_WAIVER_REQUESTED', 'RentalLateFeeWaiver', w.id, { rentalOrderId, amount: dto.amount, reason: dto.reason.trim() });
    return w;
  }

  private async loadWaiver(id: string) {
    const w = await this.prisma.rentalLateFeeWaiver.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!w) throw new NotFoundException('Waiver request not found');
    return w;
  }

  /** Independent approval: never the requester. Reduces what is due (ledger), never moves money. */
  async approveLateFeeWaiver(id: string, dto: DecideLateFeeWaiverDto, actor: { id: string }) {
    const w = await this.loadWaiver(id);
    if (w.requestedById === actor.id) {
      await this.audit.log('LATE_FEE_WAIVER_DENIED', 'RentalLateFeeWaiver', id, { reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'A waiver must be approved by a different person than the one who requested it.' });
    }
    const tenantId = this.tenantContext.requireId;
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, w.rentalOrderId);
      const rental = await this.loadRental(tx, w.rentalOrderId);
      const left = round2(Number(rental.lateFee ?? 0) - Number(rental.lateFeeWaived ?? 0));
      if (Number(w.amount) > left + 0.001) throw new ConflictException(`Only ${left} TZS of the late fee is left to waive.`);
      const claimed = await tx.rentalLateFeeWaiver.updateMany({
        where: { id, tenantId, status: 'REQUESTED' },
        data: { status: 'APPROVED', decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note },
      });
      if (claimed.count !== 1) throw new ConflictException('The waiver is no longer waiting for approval. Reload.');
      await tx.rentalOrder.updateMany({ where: { id: w.rentalOrderId, tenantId }, data: { lateFeeWaived: { increment: Number(w.amount) } } });
    });
    await this.audit.log('LATE_FEE_WAIVER_APPROVED', 'RentalLateFeeWaiver', id, { rentalOrderId: w.rentalOrderId, amount: Number(w.amount), requestedBy: w.requestedById });
    return this.loadWaiver(id);
  }

  async rejectLateFeeWaiver(id: string, dto: RejectRentalRefundDto, actor: { id: string }) {
    const w = await this.loadWaiver(id);
    const res = await this.prisma.rentalLateFeeWaiver.updateMany({
      where: { id, tenantId: this.tenantContext.requireId, status: 'REQUESTED' },
      data: { status: 'REJECTED', decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.reason },
    });
    if (res.count !== 1) throw new ConflictException('The waiver is no longer waiting for approval. Reload.');
    await this.audit.log('LATE_FEE_WAIVER_REJECTED', 'RentalLateFeeWaiver', id, { rentalOrderId: w.rentalOrderId, reason: dto.reason });
    return this.loadWaiver(id);
  }
}
