import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

export class ApplyReferralDto {
  code: string;
}

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCode(userId: string) {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { userId },
      include: { referrals: true },
    });

    if (!referralCode) {
      return { code: null, message: 'No referral code yet. Generate one first.' };
    }

    return {
      code: referralCode.code,
      usageCount: referralCode.referrals.length,
      createdAt: referralCode.createdAt,
    };
  }

  async generateCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({
      where: { userId },
    });

    if (existing) {
      return { code: existing.code, message: 'You already have a referral code.' };
    }

    const code = 'NARO-' + randomBytes(4).toString('hex').toUpperCase();

    const referralCode = await this.prisma.referralCode.create({
      data: { userId, code },
    });

    return { code: referralCode.code, message: 'Referral code generated successfully.' };
  }

  async applyCode(userId: string, dto: ApplyReferralDto) {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code: dto.code },
    });

    if (!referralCode) {
      throw new NotFoundException('Invalid referral code');
    }

    if (referralCode.userId === userId) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    // Check if user already used a referral code
    const alreadyUsed = await this.prisma.referral.findUnique({
      where: { referredUserId: userId },
    });

    if (alreadyUsed) {
      throw new BadRequestException('You have already used a referral code');
    }

    // Record the referral
    await this.prisma.referral.create({
      data: {
        referralCodeId: referralCode.id,
        referrerId: referralCode.userId,
        referredUserId: userId,
      },
    });

    return { message: 'Referral code applied successfully' };
  }

  async getStats() {
    const referralCodes = await this.prisma.referralCode.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        referrals: {
          include: {
            referredUser: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalReferralCodes = referralCodes.length;
    const totalUsages = referralCodes.reduce((sum, r) => sum + r.referrals.length, 0);

    return { totalReferralCodes, totalUsages, referralCodes };
  }
}
