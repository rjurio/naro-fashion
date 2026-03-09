import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Injectable()
export class RentalPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const policy = await this.prisma.rentalPolicy.findFirst();
    if (!policy) {
      // Create default policy if none exists
      return this.prisma.rentalPolicy.create({
        data: {
          bufferDaysBetweenRentals: 7,
          defaultDownPaymentPct: 25,
          lateFeePerDay: 10000,
          maxRentalDurationDays: 30,
          advancePreparationReminderDays: 8,
        },
      });
    }
    return policy;
  }

  async update(dto: UpdatePolicyDto) {
    let policy = await this.prisma.rentalPolicy.findFirst();
    if (!policy) {
      // Create with provided values
      return this.prisma.rentalPolicy.create({
        data: {
          bufferDaysBetweenRentals: dto.bufferDaysBetweenRentals ?? 7,
          defaultDownPaymentPct: dto.defaultDownPaymentPct ?? 25,
          lateFeePerDay: dto.lateFeePerDay ?? 10000,
          maxRentalDurationDays: dto.maxRentalDurationDays ?? 30,
          advancePreparationReminderDays:
            dto.advancePreparationReminderDays ?? 8,
        },
      });
    }

    const data: any = {};
    if (dto.bufferDaysBetweenRentals !== undefined)
      data.bufferDaysBetweenRentals = dto.bufferDaysBetweenRentals;
    if (dto.defaultDownPaymentPct !== undefined)
      data.defaultDownPaymentPct = dto.defaultDownPaymentPct;
    if (dto.lateFeePerDay !== undefined)
      data.lateFeePerDay = dto.lateFeePerDay;
    if (dto.maxRentalDurationDays !== undefined)
      data.maxRentalDurationDays = dto.maxRentalDurationDays;
    if (dto.advancePreparationReminderDays !== undefined)
      data.advancePreparationReminderDays =
        dto.advancePreparationReminderDays;

    return this.prisma.rentalPolicy.update({
      where: { id: policy.id },
      data,
    });
  }
}
