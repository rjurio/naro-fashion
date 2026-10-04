import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import {
  isMaskedValue,
  maskPaymentMethod,
  restoreMaskedSecrets,
} from './secret-mask.util';

export class CreatePaymentMethodDto {
  @IsString() name: string;
  @IsString() code: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) sortOrder?: number;
  @IsOptional() @IsString() integrationKey?: string;
  @IsOptional() @IsObject() integrationParams?: Record<string, unknown>;
}

export class UpdatePaymentMethodDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) sortOrder?: number;
  @IsOptional() @IsString() integrationKey?: string;
  @IsOptional() @IsObject() integrationParams?: Record<string, unknown>;
}

@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  // Public storefront read — MUST NOT expose gateway credentials.
  // `integrationParams` (ClickPesa/Mixx clientId/apiKey/checksumSecret) and
  // `integrationKey` are secrets; the storefront only needs display fields.
  findAll() {
    return this.prisma.paymentMethod.findMany({
      where: { isActive: true, deletedAt: null, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        iconUrl: true,
        isActive: true,
        sortOrder: true,
      },
    });
  }

  // Admin reads: gateway secrets inside integrationParams / integrationKey are
  // masked ('••••' + last 4) — even a permitted admin never gets them back in
  // clear over the API. Every admin response below goes through
  // maskPaymentMethod for the same reason.
  async findAllAdmin() {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { deletedAt: null, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(maskPaymentMethod);
  }

  async findDeleted() {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { deletedAt: { not: null }, tenantId: this.tenantContext.id },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(maskPaymentMethod);
  }

  async create(dto: CreatePaymentMethodDto) {
    try {
      const { integrationParams, ...rest } = dto;
      const created = await this.prisma.paymentMethod.create({
        data: {
          ...rest,
          integrationParams: integrationParams
            ? JSON.parse(JSON.stringify(integrationParams))
            : undefined,
          tenantId: this.tenantContext.id,
        },
      });
      return maskPaymentMethod(created);
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
    const existing = await this.findOneOrFail(id);
    try {
      const { integrationParams, integrationKey, ...rest } = dto;
      // The admin UI round-trips the masked values it was shown; a masked
      // value means "keep the stored secret", never "store the mask".
      const updated = await this.prisma.paymentMethod.update({
        where: { id },
        data: {
          ...rest,
          ...(integrationKey !== undefined &&
            !isMaskedValue(integrationKey) && { integrationKey }),
          ...(integrationParams !== undefined && {
            integrationParams: JSON.parse(
              JSON.stringify(
                restoreMaskedSecrets(
                  integrationParams,
                  existing.integrationParams,
                ),
              ),
            ),
          }),
        },
      });
      return maskPaymentMethod(updated);
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
    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: { isActive: !method.isActive },
    });
    return maskPaymentMethod(updated);
  }

  async softDelete(id: string) {
    await this.findOneOrFail(id);
    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return maskPaymentMethod(updated);
  }

  async restore(id: string) {
    // Tenant-scoped: an admin must not restore another tenant's method by id.
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, tenantId: this.tenantContext.id },
    });
    if (!method) throw new NotFoundException('Payment method not found');
    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
    return maskPaymentMethod(updated);
  }

  // Tenant-scoped lookup used by update/toggleActive/softDelete. Without the
  // tenantId filter an authenticated admin of tenant A could read (via a no-op
  // update) or mutate tenant B's payment method — including its gateway
  // credentials — by id.
  private async findOneOrFail(id: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, deletedAt: null, tenantId: this.tenantContext.id },
    });
    if (!method) throw new NotFoundException('Payment method not found');
    return method;
  }
}
