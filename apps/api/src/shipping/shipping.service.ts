import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async getZones() {
    return this.prisma.shippingZone.findMany({
      include: { rates: true },
      orderBy: { name: 'asc' },
    });
  }

  async getZone(id: string) {
    const zone = await this.prisma.shippingZone.findUnique({
      where: { id },
      include: { rates: true },
    });
    if (!zone) {
      throw new NotFoundException('Shipping zone not found');
    }
    return zone;
  }

  async createZone(dto: CreateZoneDto) {
    return this.prisma.shippingZone.create({
      data: {
        name: dto.name,
        description: dto.description,
        regions: dto.regions,
        isActive: dto.isActive ?? true,
        rates: dto.rates
          ? {
              create: dto.rates.map((rate) => ({
                name: rate.name,
                minWeight: rate.minWeight,
                maxWeight: rate.maxWeight,
                minOrderAmount: rate.minOrderAmount,
                price: rate.price,
                isFreeAbove: rate.isFreeAbove,
                estimatedDays: rate.estimatedDays,
                isActive: rate.isActive ?? true,
              })),
            }
          : undefined,
      },
      include: { rates: true },
    });
  }

  async updateZone(id: string, dto: UpdateZoneDto) {
    const zone = await this.prisma.shippingZone.findUnique({
      where: { id },
    });
    if (!zone) {
      throw new NotFoundException('Shipping zone not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.regions !== undefined) data.regions = dto.regions;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.rates !== undefined) {
      // Delete existing rates and recreate
      await this.prisma.shippingRate.deleteMany({
        where: { shippingZoneId: id },
      });
      data.rates = {
        create: dto.rates.map((rate) => ({
          name: rate.name,
          minWeight: rate.minWeight,
          maxWeight: rate.maxWeight,
          minOrderAmount: rate.minOrderAmount,
          price: rate.price,
          isFreeAbove: rate.isFreeAbove,
          estimatedDays: rate.estimatedDays,
          isActive: rate.isActive ?? true,
        })),
      };
    }

    return this.prisma.shippingZone.update({
      where: { id },
      data,
      include: { rates: true },
    });
  }

  async deleteZone(id: string) {
    const zone = await this.prisma.shippingZone.findUnique({
      where: { id },
    });
    if (!zone) {
      throw new NotFoundException('Shipping zone not found');
    }

    await this.prisma.shippingZone.delete({ where: { id } });
    return { message: 'Shipping zone deleted' };
  }

  async calculateRate(zoneId: string, orderAmount: number) {
    const zone = await this.prisma.shippingZone.findUnique({
      where: { id: zoneId },
      include: { rates: { where: { isActive: true } } },
    });
    if (!zone) {
      throw new NotFoundException('Shipping zone not found');
    }

    const applicableRates = zone.rates
      .filter((rate) => {
        if (
          rate.minOrderAmount &&
          orderAmount < Number(rate.minOrderAmount)
        )
          return false;
        return true;
      })
      .map((rate) => {
        const isFree =
          rate.isFreeAbove && orderAmount >= Number(rate.isFreeAbove);
        return {
          id: rate.id,
          name: rate.name,
          price: isFree ? 0 : Number(rate.price),
          estimatedDays: rate.estimatedDays,
          isFreeShipping: !!isFree,
        };
      })
      .sort((a, b) => a.price - b.price);

    return {
      zoneId,
      zoneName: zone.name,
      orderAmount,
      rates: applicableRates,
    };
  }

  async createShipment(dto: CreateShipmentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const existingShipment = await this.prisma.shipment.findUnique({
      where: { orderId: dto.orderId },
    });
    if (existingShipment) {
      throw new ConflictException('Shipment already exists for this order');
    }

    return this.prisma.shipment.create({
      data: {
        orderId: dto.orderId,
        carrier: dto.carrier,
        trackingCode: dto.trackingCode,
        shippingZoneId: dto.shippingZoneId,
        estimatedDelivery: dto.estimatedDelivery
          ? new Date(dto.estimatedDelivery)
          : undefined,
        status: 'PREPARING',
      },
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true },
        },
        shippingZone: { select: { id: true, name: true } },
      },
    });
  }

  async updateShipment(id: string, dto: UpdateShipmentDto) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });
    if (!shipment) {
      throw new NotFoundException('Shipment not found');
    }

    const data: any = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.trackingCode !== undefined) data.trackingCode = dto.trackingCode;
    if (dto.carrier !== undefined) data.carrier = dto.carrier;
    if (dto.estimatedDelivery !== undefined)
      data.estimatedDelivery = new Date(dto.estimatedDelivery);
    if (dto.shippedAt !== undefined) data.shippedAt = new Date(dto.shippedAt);
    if (dto.deliveredAt !== undefined)
      data.deliveredAt = new Date(dto.deliveredAt);

    // Auto-set timestamps based on status
    if (dto.status === 'SHIPPED' && !dto.shippedAt) {
      data.shippedAt = new Date();
    }
    if (dto.status === 'DELIVERED' && !dto.deliveredAt) {
      data.deliveredAt = new Date();
    }

    return this.prisma.shipment.update({
      where: { id },
      data,
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true },
        },
        shippingZone: { select: { id: true, name: true } },
      },
    });
  }

  async getShipment(orderId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { orderId },
      include: {
        order: {
          select: { id: true, orderNumber: true, status: true },
        },
        shippingZone: { select: { id: true, name: true } },
      },
    });
    if (!shipment) {
      throw new NotFoundException('Shipment not found for this order');
    }
    return shipment;
  }
}
