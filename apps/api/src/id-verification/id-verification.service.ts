import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export class SubmitIdVerificationDto {
  frontImageUrl: string;
  backImageUrl: string;
  idNumber: string;
}

export class RejectVerificationDto {
  reason: string;
}

@Injectable()
export class IdVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(userId: string, dto: SubmitIdVerificationDto) {
    // Check if user already has a pending or approved verification
    const existing = await this.prisma.customerIDDocument.findFirst({
      where: {
        userId,
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
        userId,
        frontImageUrl: dto.frontImageUrl,
        backImageUrl: dto.backImageUrl,
        idNumber: dto.idNumber,
        verificationStatus: 'PENDING',
      },
    });
  }

  async getStatus(userId: string) {
    const verification = await this.prisma.customerIDDocument.findFirst({
      where: { userId },
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
    return this.prisma.customerIDDocument.findMany({
      where: { verificationStatus: 'PENDING' },
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
    const verification = await this.prisma.customerIDDocument.findUnique({
      where: { id },
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
      );
    }

    return updated;
  }

  async reject(id: string, dto: RejectVerificationDto) {
    const verification = await this.prisma.customerIDDocument.findUnique({
      where: { id },
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
      );
    }

    return updated;
  }
}
