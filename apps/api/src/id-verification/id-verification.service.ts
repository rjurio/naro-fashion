import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { parseIdDocKey, PRIVATE_REF_PREFIX } from '../upload/private-storage.util';
import { lockCustomerIdState } from './id-approval';
import { decideHold, formatEatDeadline, pickupCutoff, rejectedHold } from '../rentals/rental-hold';

export class SubmitIdVerificationDto {
  @IsString() @MaxLength(200) frontImageUrl: string;
  @IsString() @MaxLength(200) backImageUrl: string;
  @IsString() @MaxLength(50) idNumber: string;
}

export class RejectVerificationDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}

/** What an ID approval did to the customer's waiting bookings. */
export interface IdApprovalReconciliation {
  /** Bookings moved PENDING_ID_VERIFICATION -> ID_VERIFIED. */
  idVerified: number;
  /** Of those, bookings whose down payment was already covered by COMPLETED payments -> DOWN_PAYMENT_PAID. */
  confirmed: number;
  rentalNumbers: string[];
  /**
   * Waiting bookings NOT advanced because they had already expired (their
   * deadline or pickup day passed before the approval); the hold expiry job
   * releases them.
   */
  expired: number;
  /** Fresh down-payment deadline given to the advanced bookings, if any (ISO). */
  paymentDueBy: string | null;
}

/**
 * Bookings an ID event may act on: still waiting for the ID, not expired
 * (deadline null = paused, or still in the future) and pickup day not over.
 */
function liveWaitingBookings(tenantId: string, userId: string, now: Date) {
  return {
    tenantId,
    userId,
    status: 'PENDING_ID_VERIFICATION',
    pickupDate: { gte: pickupCutoff(now) },
    OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
  };
}

@Injectable()
export class IdVerificationService {
  private readonly logger = new Logger(IdVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  async submit(userId: string, dto: SubmitIdVerificationDto) {
    const tenantId = this.tenantContext.requireId;

    // The image refs must be private:// references produced by
    // POST /upload/id-document for THIS tenant. Previously any string was
    // accepted, so a customer could submit an arbitrary external URL (e.g. a
    // tracking pixel / phishing link) that admins would then open.
    for (const ref of [dto.frontImageUrl, dto.backImageUrl]) {
      const parsed = parseIdDocKey(ref);
      if (!parsed || !ref.startsWith(PRIVATE_REF_PREFIX) || parsed.tenantId !== tenantId) {
        throw new BadRequestException(
          'Invalid ID document reference — upload the images via /upload/id-document first',
        );
      }
    }

    // Under the per-customer lock bookings and reviews take: the duplicate
    // check and the insert can't race a second submission, and the pause
    // below can't interleave with a booking or a review.
    const now = new Date();
    const { doc, paused } = await this.prisma.$transaction(async (tx) => {
      await lockCustomerIdState(tx, tenantId, userId);
      const existing = await tx.customerIDDocument.findFirst({
        where: {
          userId,
          tenantId,
          verificationStatus: { in: ['PENDING', 'APPROVED'] },
        },
      });

      if (existing?.verificationStatus === 'APPROVED') {
        throw new BadRequestException('Your ID is already verified');
      }

      if (existing?.verificationStatus === 'PENDING') {
        throw new BadRequestException(
          'You already have a pending verification request',
        );
      }

      const created = await tx.customerIDDocument.create({
        data: {
          tenantId,
          userId,
          frontImageUrl: dto.frontImageUrl,
          backImageUrl: dto.backImageUrl,
          idNumber: dto.idNumber,
          verificationStatus: 'PENDING',
        },
      });

      // Owner rule 2026-11-12: while the ID waits for staff review, the
      // booking's deadline is PAUSED (staff delay must not cost the
      // customer the booking). Only bookings that are still live: one whose
      // deadline already passed is not revived by a late upload.
      const res = await tx.rentalOrder.updateMany({
        where: liveWaitingBookings(tenantId, userId, now),
        data: { holdState: 'ID_UNDER_REVIEW', holdExpiresAt: null },
      });
      return { doc: created, paused: res.count };
    });
    if (paused > 0) {
      this.logger.log(
        `[RENTAL_HOLD] ID submitted: ${paused} waiting booking(s) paused for staff review (document ${doc.id})`,
      );
    }
    return doc;
  }

  async getStatus(userId: string) {
    const tenantId = this.tenantContext.requireId;

    const verification = await this.prisma.customerIDDocument.findFirst({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        verificationStatus: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!verification) {
      return { verified: false, status: null, message: 'No verification submitted' };
    }

    return {
      verified: verification.verificationStatus === 'APPROVED',
      ...verification,
    };
  }

  async getPending() {
    const tenantId = this.tenantContext.requireId;

    return this.prisma.customerIDDocument.findMany({
      where: { verificationStatus: 'PENDING', tenantId },
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
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Approve a PENDING ID document (staff with id-verification:review).
   *
   * In ONE transaction, under the per-customer lock bookings also take:
   *  - the document moves PENDING -> APPROVED by compare-and-swap, so a
   *    repeated or concurrent approval is refused (409) and does nothing;
   *  - each of the customer's LIVE bookings still PENDING_ID_VERIFICATION in
   *    this tenant (deadline paused or not yet passed, pickup day not over)
   *    moves to ID_VERIFIED by CAS, with a FRESH down-payment deadline from
   *    the approval (RENTAL_HOLD_TTL_HOURS, 48 h) — or none when no down
   *    payment is due. Expired ones are left for the hold expiry job.
   *    Nothing else is touched: confirmed, handed-over, returned, closed or
   *    cancelled bookings are never modified, and no payment is created or
   *    changed.
   *
   * Then each advanced booking goes through the SHARED payment roll-up
   * (PaymentSettlementService.updateRentalPaymentStatus): only COMPLETED
   * payments count (PENDING / PROCESSING never do), and it is confirmed
   * (DOWN_PAYMENT_PAID) only if they cover the stored down payment. A
   * booking with no payment at all is never confirmed automatically — staff
   * confirm it (this includes bookings that need no down payment).
   * Availability is not re-checked: a waiting booking has held its dates
   * since it was created.
   */
  async approve(id: string) {
    const tenantId = this.tenantContext.requireId;

    const verification = await this.prisma.customerIDDocument.findFirst({
      where: { id, tenantId },
      include: { user: { select: { email: true } } },
    });

    if (!verification) throw new NotFoundException('Verification not found');
    if (verification.verificationStatus !== 'PENDING') {
      throw new BadRequestException('Verification is not in pending status');
    }
    const userId = verification.userId;

    const now = new Date();
    const { updated, advanced, expired } = await this.prisma.$transaction(async (tx) => {
      await lockCustomerIdState(tx, tenantId, userId);
      const claim = await tx.customerIDDocument.updateMany({
        where: { id, tenantId, verificationStatus: 'PENDING' },
        data: { verificationStatus: 'APPROVED', verifiedAt: now },
      });
      if (claim.count === 0) {
        throw new ConflictException('This ID was already reviewed by someone else. Reload the queue.');
      }
      await tx.user.updateMany({ where: { id: userId, tenantId }, data: { isVerified: true } });

      // Only LIVE waiting bookings move on. One that had already expired
      // (deadline or pickup day passed) is left for the hold expiry job.
      const live = liveWaitingBookings(tenantId, userId, now);
      const waiting = await tx.rentalOrder.findMany({
        where: live,
        select: { id: true, rentalNumber: true, downPaymentAmount: true },
        orderBy: { createdAt: 'asc' },
      });
      const moved: { id: string; rentalNumber: string; holdState: string; holdExpiresAt: Date | null }[] = [];
      for (const r of waiting) {
        // A FRESH window from the approval (staff review time never counts
        // against the customer), or none when no down payment is due.
        const hold = decideHold({ idState: 'APPROVED', downPaymentAmount: Number(r.downPaymentAmount), at: now });
        const res = await tx.rentalOrder.updateMany({
          where: { ...live, id: r.id },
          data: { status: 'ID_VERIFIED', ...hold },
        });
        if (res.count > 0) moved.push({ id: r.id, rentalNumber: r.rentalNumber, ...hold });
      }
      const notLive = await tx.rentalOrder.count({
        where: { tenantId, userId, status: 'PENDING_ID_VERIFICATION' },
      });
      const doc = await tx.customerIDDocument.findFirst({ where: { id, tenantId } });
      return { updated: doc, advanced: moved, expired: notLive };
    });

    const due = advanced.find((r) => r.holdExpiresAt)?.holdExpiresAt ?? null;
    const reconciled: IdApprovalReconciliation = {
      idVerified: advanced.length,
      confirmed: 0,
      rentalNumbers: [],
      expired,
      paymentDueBy: due ? due.toISOString() : null,
    };
    const awaitingPayment: string[] = [];
    for (const r of advanced) {
      // A booking with no COMPLETED payment stays ID_VERIFIED (awaiting the
      // down payment, or staff confirmation when none is required).
      const paid = await this.settlement.sumCompleted({ rentalOrderId: r.id }, tenantId);
      if (paid > 0) await this.settlement.updateRentalPaymentStatus(r.id, tenantId);
      const current = await this.prisma.rentalOrder.findFirst({
        where: { id: r.id, tenantId },
        select: { status: true },
      });
      const to = current?.status ?? 'ID_VERIFIED';
      if (to === 'DOWN_PAYMENT_PAID') reconciled.confirmed++;
      else if (r.holdExpiresAt) awaitingPayment.push(r.rentalNumber);
      reconciled.rentalNumbers.push(r.rentalNumber);
      await this.auditService.log('UPDATE_STATUS', 'Rental', r.id, {
        from: 'PENDING_ID_VERIFICATION',
        to,
        source: 'ID_APPROVED',
        idDocumentId: id,
        holdState: r.holdState,
        holdExpiresAt: r.holdExpiresAt,
      });
    }
    await this.auditService.log('APPROVE_ID', 'CustomerIDDocument', id, {
      idVerified: reconciled.idVerified,
      confirmed: reconciled.confirmed,
      expired: reconciled.expired,
      paymentDueBy: reconciled.paymentDueBy,
    });

    if (verification.user.email) {
      await this.notifications.sendIdVerificationUpdate(
        verification.user.email,
        'APPROVED',
        undefined,
        {
          tenantId,
          rentalNumbers: awaitingPayment,
          deadline: awaitingPayment.length && due ? formatEatDeadline(due) : undefined,
        },
      );
    }

    return { ...updated, reconciled };
  }

  /**
   * Reject a PENDING ID document (staff with id-verification:review). CAS on
   * PENDING, so a document already reviewed is never flipped. The customer's
   * waiting bookings (paused for this review) stay PENDING_ID_VERIFICATION
   * and get an EXPLICIT window (RENTAL_HOLD_TTL_HOURS, 48 h) to submit a new
   * ID; the email says until when. A new submission pauses the clock again.
   */
  async reject(id: string, dto: RejectVerificationDto) {
    const tenantId = this.tenantContext.requireId;

    const verification = await this.prisma.customerIDDocument.findFirst({
      where: { id, tenantId },
      include: { user: { select: { email: true } } },
    });

    if (!verification) throw new NotFoundException('Verification not found');
    if (verification.verificationStatus !== 'PENDING') {
      throw new BadRequestException('Verification is not in pending status');
    }

    const userId = verification.userId;
    const now = new Date();
    const hold = rejectedHold(now);
    const { updated, bookings } = await this.prisma.$transaction(async (tx) => {
      await lockCustomerIdState(tx, tenantId, userId);
      const claim = await tx.customerIDDocument.updateMany({
        where: { id, tenantId, verificationStatus: 'PENDING' },
        data: { verificationStatus: 'REJECTED', rejectionReason: dto.reason, verifiedAt: now },
      });
      if (claim.count === 0) {
        throw new ConflictException('This ID was already reviewed by someone else. Reload the queue.');
      }
      const where = {
        tenantId,
        userId,
        status: 'PENDING_ID_VERIFICATION',
        pickupDate: { gte: pickupCutoff(now) },
        holdExpiresAt: null,
        OR: [{ holdState: 'ID_UNDER_REVIEW' }, { holdState: null }],
      };
      const affected = await tx.rentalOrder.findMany({ where, select: { rentalNumber: true } });
      if (affected.length) await tx.rentalOrder.updateMany({ where, data: hold });
      const doc = await tx.customerIDDocument.findFirst({ where: { id, tenantId } });
      return { updated: doc, bookings: affected.map((b) => b.rentalNumber) };
    });
    await this.auditService.log('REJECT_ID', 'CustomerIDDocument', id, {
      bookingsGivenResubmissionWindow: bookings.length,
      ...(bookings.length > 0 && { holdState: hold.holdState, holdExpiresAt: hold.holdExpiresAt }),
    });

    if (verification.user.email) {
      await this.notifications.sendIdVerificationUpdate(
        verification.user.email,
        'REJECTED',
        dto.reason,
        {
          tenantId,
          rentalNumbers: bookings,
          deadline: bookings.length && hold.holdExpiresAt ? formatEatDeadline(hold.holdExpiresAt) : undefined,
        },
      );
    }

    return updated;
  }
}
