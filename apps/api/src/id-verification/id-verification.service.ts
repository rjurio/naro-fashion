import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { NotificationsService } from '../notifications/notifications.service';
import { parseIdDocKey, PRIVATE_REF_PREFIX } from '../upload/private-storage.util';

export class SubmitIdVerificationDto {
  @IsString() @MaxLength(200) frontImageUrl: string;
  @IsString() @MaxLength(200) backImageUrl: string;
  @IsString() @MaxLength(50) idNumber: string;
}

export class RejectVerificationDto {
  @IsString() reason: string;
}

@Injectable()
export class IdVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenantContext: TenantContext,
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

    const updated = await this.prisma.customerIDDocument.update({
      where: { id },
      data: { verificationStatus: 'APPROVED', verifiedAt: new Date() },
    });

    // Mark user as verified
    await this.prisma.user.update({
      where: { id: verification.userId },
      data: { isVerified: true },
    });

    if (verification.user.email) {
      await this.notifications.sendIdVerificationUpdate(
        verification.user.email,
        'APPROVED',
        undefined,
        { tenantId },
      );
    }

    return updated;
  }

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

    const updated = await this.prisma.customerIDDocument.update({
      where: { id },
      data: {
        verificationStatus: 'REJECTED',
        rejectionReason: dto.reason,
      },
    });

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
