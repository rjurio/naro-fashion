import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRentalDto } from './dto/create-rental.dto';
import { QueryRentalsDto } from './dto/query-rentals.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class RentalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRentalDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
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
      where: { id: dto.variantId },
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

    const policy = await this.prisma.rentalPolicy.findFirst();
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

    const rentalPricePerDay = product.rentalPricePerDay
      ? Number(product.rentalPricePerDay)
      : Number(product.basePrice) * 0.1;
    const depositAmount = product.rentalDepositAmount
      ? Number(product.rentalDepositAmount)
      : 0;
    const downPaymentPct =
      product.rentalDownPaymentPct ??
      policy?.defaultDownPaymentPct ??
      25;

    const totalRentalPrice = rentalPricePerDay * rentalDays;
    const downPaymentAmount = totalRentalPrice * (downPaymentPct / 100);

    // Check ID verification status
    const idDoc = await this.prisma.customerIDDocument.findFirst({
      where: { userId, verificationStatus: 'APPROVED' },
    });
    const initialStatus = idDoc
      ? 'ID_VERIFIED'
      : 'PENDING_ID_VERIFICATION';

    const rentalNumber = `RNT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    return this.prisma.rentalOrder.create({
      data: {
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
      },
      include: {
        product: { select: { id: true, name: true, slug: true } },
        variant: { select: { id: true, name: true, sku: true } },
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.rentalOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, slug: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  async findAllAdmin(query: QueryRentalsDto) {
    const { status, startDate, endDate, page = 1, limit = 20 } = query;
    const where: any = {};

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

  async findOne(id: string) {
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id },
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

  async updateStatus(id: string, status: string) {
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    const workflow = [
      'PENDING_ID_VERIFICATION',
      'ID_VERIFIED',
      'DOWN_PAYMENT_PAID',
      'FULLY_PAID',
      'READY_FOR_PICKUP',
      'ITEM_DISPATCHED',
      'ACTIVE',
      'RETURNED',
      'INSPECTION',
      'CLOSED',
    ];

    const currentIndex = workflow.indexOf(rental.status);
    const targetIndex = workflow.indexOf(status);

    if (targetIndex <= currentIndex) {
      throw new BadRequestException(
        `Cannot move from ${rental.status} to ${status}. Status can only advance forward.`,
      );
    }

    const data: any = { status };
    if (status === 'RETURNED') {
      data.actualReturnDate = new Date();
    }

    return this.prisma.rentalOrder.update({
      where: { id },
      data,
      include: {
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
  }

  async markReadyForPickup(id: string) {
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    return this.prisma.rentalOrder.update({
      where: { id },
      data: { isReadyForPickup: true },
    });
  }

  async getAvailability(
    productId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const policy = await this.prisma.rentalPolicy.findFirst();
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
        productId,
        status: {
          notIn: ['CLOSED', 'RETURNED', 'INSPECTION'],
        },
        startDate: { lt: bufferedEnd },
        returnDate: { gt: bufferedStart },
      },
    });

    return overlapping === 0;
  }
}
