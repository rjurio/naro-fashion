import {
  Injectable,
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
}

@Injectable()
export class IdVerificationService {
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

    // Check if user already has a pending or approved verification
    const existing = await this.prisma.customerIDDocument.findFirst({
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

    return this.prisma.customerIDDocument.create({
      data: {
        tenantId,
        userId,
        frontImageUrl: dto.frontImageUrl,
        backImageUrl: dto.backImageUrl,
        idNumber: dto.idNumber,
        verificationStatus: 'PENDING',
      },
    });
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
   *  - each of the customer's bookings still PENDING_ID_VERIFICATION in this
   *    tenant moves to ID_VERIFIED (CAS on the status). Nothing else is
   *    touched: confirmed, handed-over, returned, closed or cancelled
   *    bookings are never modified, and no payment is created or changed.
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

    const { updated, advanced } = await this.prisma.$transaction(async (tx) => {
      await lockCustomerIdState(tx, tenantId, userId);
      const claim = await tx.customerIDDocument.updateMany({
        where: { id, tenantId, verificationStatus: 'PENDING' },
        data: { verificationStatus: 'APPROVED', verifiedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException('This ID was already reviewed by someone else. Reload the queue.');
      }
      await tx.user.updateMany({ where: { id: userId, tenantId }, data: { isVerified: true } });

      const waiting = await tx.rentalOrder.findMany({
        where: { tenantId, userId, status: 'PENDING_ID_VERIFICATION' },
        select: { id: true, rentalNumber: true },
        orderBy: { createdAt: 'asc' },
      });
      const moved: { id: string; rentalNumber: string }[] = [];
      for (const r of waiting) {
        const res = await tx.rentalOrder.updateMany({
          where: { id: r.id, tenantId, status: 'PENDING_ID_VERIFICATION' },
          data: { status: 'ID_VERIFIED' },
        });
        if (res.count > 0) moved.push(r);
      }
      const doc = await tx.customerIDDocument.findFirst({ where: { id, tenantId } });
      return { updated: doc, advanced: moved };
    });

    const reconciled: IdApprovalReconciliation = { idVerified: advanced.length, confirmed: 0, rentalNumbers: [] };
    for (const r of advanced) {
      // A booking with no COMPLETED payment stays ID_VERIFIED (awaiting the
      // down payment, or staff confirmation when none is required).
      const paid = await this.settlement.sumCompleted({ rentalOrderId: r.id }, tenantId);
      if (paid > 0) await this.settlement.updateRentalPaymentStatus(r.id, tenantId);
      const now = await this.prisma.rentalOrder.findFirst({
        where: { id: r.id, tenantId },
        select: { status: true },
      });
      const to = now?.status ?? 'ID_VERIFIED';
      if (to === 'DOWN_PAYMENT_PAID') reconciled.confirmed++;
      reconciled.rentalNumbers.push(r.rentalNumber);
      await this.auditService.log('UPDATE_STATUS', 'Rental', r.id, {
        from: 'PENDING_ID_VERIFICATION',
        to,
        source: 'ID_APPROVED',
        idDocumentId: id,
      });
    }
    await this.auditService.log('APPROVE_ID', 'CustomerIDDocument', id, {
      idVerified: reconciled.idVerified,
      confirmed: reconciled.confirmed,
    });

    if (verification.user.email) {
      await this.notifications.sendIdVerificationUpdate(
        verification.user.email,
        'APPROVED',
        undefined,
        { tenantId },
      );
    }

    return { ...updated, reconciled };
  }

  /**
   * Reject a PENDING ID document (staff with id-verification:review). CAS on
   * PENDING, so a document already reviewed is never flipped. Bookings are
   * not changed: they stay PENDING_ID_VERIFICATION and the customer can
   * submit a new document.
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

    const claim = await this.prisma.customerIDDocument.updateMany({
      where: { id, tenantId, verificationStatus: 'PENDING' },
      data: { verificationStatus: 'REJECTED', rejectionReason: dto.reason },
    });
    if (claim.count === 0) {
      throw new ConflictException('This ID was already reviewed by someone else. Reload the queue.');
    }
    const updated = await this.prisma.customerIDDocument.findFirst({ where: { id, tenantId } });
    await this.auditService.log('REJECT_ID', 'CustomerIDDocument', id);

    if (verification.user.email) {
      await this.notifications.sendIdVerificationUpdate(
        verification.user.email,
        'REJECTED',
        dto.reason,
        { tenantId },
      );
    }

    return updated;
  }
}
