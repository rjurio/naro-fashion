import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

export class CreatePaymentMethodDto {
  name: string;
  code: string;
  description?: string;
  iconUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
  integrationKey?: string;
  integrationParams?: Record<string, unknown>;
}

export class UpdatePaymentMethodDto {
  name?: string;
  code?: string;
  description?: string;
  iconUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
  integrationKey?: string;
  integrationParams?: Record<string, unknown>;
}

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  findAll() {
    return this.prisma.paymentMethod.findMany({
      where: { isActive: true, deletedAt: null, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findAllAdmin() {
    return this.prisma.paymentMethod.findMany({
      where: { deletedAt: null, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  findDeleted() {
    return this.prisma.paymentMethod.findMany({
      where: { deletedAt: { not: null }, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(dto: CreatePaymentMethodDto) {
    try {
      const { integrationParams, ...rest } = dto;
      return await this.prisma.paymentMethod.create({
        data: {
          ...rest,
          integrationParams: integrationParams
            ? JSON.parse(JSON.stringify(integrationParams))
            : undefined,
          tenantId: this.tenantContext.id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          `A payment method with code "${dto.code}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    await this.findOneOrFail(id);
    try {
      const { integrationParams, ...rest } = dto;
      return await this.prisma.paymentMethod.update({
        where: { id },
        data: {
          ...rest,
          ...(integrationParams !== undefined && {
            integrationParams: JSON.parse(JSON.stringify(integrationParams)),
          }),
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          `A payment method with that code already exists`,
        );
      }
      throw err;
    }
  }

  async toggleActive(id: string) {
    const method = await this.findOneOrFail(id);
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { isActive: !method.isActive },
    });
  }

  async softDelete(id: string) {
    await this.findOneOrFail(id);
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async restore(id: string) {
    const method = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Payment method not found');
    return this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  private async findOneOrFail(id: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, deletedAt: null },
    });
    if (!method) throw new NotFoundException('Payment method not found');
    return method;
  }
}
