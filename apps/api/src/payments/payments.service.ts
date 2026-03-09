import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePaymentDto) {
    if (!dto.orderId && !dto.rentalOrderId) {
      throw new BadRequestException(
        'Either orderId or rentalOrderId must be provided',
      );
    }

    // Verify order/rental exists
    if (dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
    }

    if (dto.rentalOrderId) {
      const rental = await this.prisma.rentalOrder.findUnique({
        where: { id: dto.rentalOrderId },
      });
      if (!rental) {
        throw new NotFoundException('Rental order not found');
      }
    }

    const transactionRef =
      dto.transactionRef || `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return this.prisma.payment.create({
      data: {
        orderId: dto.orderId,
        rentalOrderId: dto.rentalOrderId,
        amount: dto.amount,
        method: dto.method,
        status: 'PENDING',
        transactionRef,
      },
      include: {
        order: { select: { id: true, orderNumber: true, total: true } },
        rentalOrder: {
          select: { id: true, rentalNumber: true, totalRentalPrice: true },
        },
      },
    });
  }

  async findByOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByRental(rentalOrderId: string) {
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id: rentalOrderId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    return this.prisma.payment.findMany({
      where: { rentalOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, dto: UpdatePaymentDto) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const updated = await this.prisma.payment.update({
      where: { id },
      data: {
        status: dto.status,
        gatewayResponse: dto.gatewayResponse ?? undefined,
      },
      include: {
        order: { select: { id: true, orderNumber: true } },
        rentalOrder: { select: { id: true, rentalNumber: true } },
      },
    });

    // If payment completed and linked to an order, update order payment status
    if (dto.status === 'COMPLETED' && updated.orderId) {
      await this.updateOrderPaymentStatus(updated.orderId);
    }

    return updated;
  }

  async handleWebhook(payload: {
    transactionRef: string;
    status: string;
    gatewayResponse?: any;
  }) {
    const payment = await this.prisma.payment.findUnique({
      where: { transactionRef: payload.transactionRef },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment with ref ${payload.transactionRef} not found`,
      );
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: payload.status,
        gatewayResponse: payload.gatewayResponse ?? undefined,
      },
    });

    // Update order/rental payment status based on total paid
    if (updated.orderId) {
      await this.updateOrderPaymentStatus(updated.orderId);
    }

    return { received: true, paymentId: updated.id, status: updated.status };
  }

  async getPaymentSummary(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const payments = await this.prisma.payment.findMany({
      where: { orderId, status: 'COMPLETED' },
    });

    const totalPaid = payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const totalDue = Number(order.total);

    return {
      orderId,
      orderNumber: order.orderNumber,
      totalDue,
      totalPaid,
      balance: totalDue - totalPaid,
      isFullyPaid: totalPaid >= totalDue,
      payments,
    };
  }

  private async updateOrderPaymentStatus(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return;

    const completedPayments = await this.prisma.payment.findMany({
      where: { orderId, status: 'COMPLETED' },
    });

    const totalPaid = completedPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const totalDue = Number(order.total);

    let paymentStatus = 'PENDING';
    if (totalPaid >= totalDue) {
      paymentStatus = 'PAID';
    } else if (totalPaid > 0) {
      paymentStatus = 'PARTIAL';
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus },
    });
  }
}
