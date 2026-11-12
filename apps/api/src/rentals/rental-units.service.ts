import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { isRentableProduct } from './rental-availability';

export const UNIT_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED', 'SOLD', 'LOST'] as const;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;

export class CreateRentalUnitDto {
  @IsString() productId!: string;
  /** Printed tag / barcode, unique per shop. */
  @IsString() @Matches(CODE, { message: 'code: 2–40 letters, digits, dot, dash or underscore' }) code!: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  /** Variant ids this unit can serve; empty / omitted = every variant of the product. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) variantIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) conditionNotes?: string;
}

export class UpdateRentalUnitDto {
  @IsOptional() @IsIn(UNIT_STATUSES as unknown as string[]) status?: (typeof UNIT_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) variantIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) conditionNotes?: string;
  /** Required when retiring / marking lost / sold, or setting maintenance. */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateUnitBlockDto {
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

/**
 * Physical rental units (POS rental MVP, M2). A product with units books by
 * free unit (rental-availability.ts); without units it keeps the legacy rule.
 * Every change is audited. Never touches sale stock.
 */
@Injectable()
export class RentalUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  private get tenantId() {
    return this.tenantContext.requireId;
  }

  async list(productId?: string) {
    return this.prisma.rentalUnit.findMany({
      where: { tenantId: this.tenantId, ...(productId ? { productId } : {}) },
      include: {
        product: { select: { id: true, name: true } },
        fits: { select: { variantId: true, variant: { select: { name: true } } } },
        blocks: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } },
      },
      orderBy: [{ productId: 'asc' }, { code: 'asc' }],
      take: 500,
    });
  }

  /** Lookup by scanned tag. */
  async byCode(code: string) {
    const u = await this.prisma.rentalUnit.findFirst({
      where: { tenantId: this.tenantId, code },
      include: { product: { select: { id: true, name: true } }, fits: { select: { variantId: true } } },
    });
    if (!u) throw new NotFoundException('No rental unit with that tag.');
    return u;
  }

  private async assertVariants(productId: string, variantIds: string[] | undefined) {
    if (!variantIds?.length) return;
    const n = await this.prisma.productVariant.count({ where: { tenantId: this.tenantId, productId, id: { in: variantIds } } });
    if (n !== new Set(variantIds).size) throw new BadRequestException('Every size must be a variant of this product.');
  }

  async create(dto: CreateRentalUnitDto) {
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId: this.tenantId } });
    if (!product || !isRentableProduct(product)) throw new BadRequestException('Units can only be added to an active rentable product.');
    await this.assertVariants(product.id, dto.variantIds);
    try {
      const unit = await this.prisma.rentalUnit.create({
        data: {
          tenantId: this.tenantId,
          productId: product.id,
          code: dto.code,
          label: dto.label,
          conditionNotes: dto.conditionNotes,
          fits: dto.variantIds?.length ? { create: [...new Set(dto.variantIds)].map((variantId) => ({ variantId })) } : undefined,
        },
      });
      await this.audit.log('UNIT_CREATED', 'RentalUnit', unit.id, { productId: product.id, code: dto.code, variantIds: dto.variantIds ?? [] });
      return unit;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Tag ${dto.code} is already used by another unit.`);
      throw e;
    }
  }

  async update(id: string, dto: UpdateRentalUnitDto) {
    const unit = await this.prisma.rentalUnit.findFirst({ where: { id, tenantId: this.tenantId } });
    if (!unit) throw new NotFoundException('Rental unit not found');
    if (dto.status && dto.status !== unit.status && dto.status !== 'ACTIVE' && !dto.note?.trim()) {
      throw new BadRequestException('Taking a unit out of service needs a note (why).');
    }
    if (dto.status && ['RETIRED', 'SOLD', 'LOST'].includes(dto.status)) {
      const future = await this.prisma.rentalOrder.count({
        where: {
          tenantId: this.tenantId,
          rentalUnitId: id,
          status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED', 'ID_REJECTED', 'RETURNED', 'INSPECTION'] },
        },
      });
      if (future > 0) throw new ConflictException(`This unit still has ${future} open booking(s). Move or cancel them first.`);
    }
    await this.assertVariants(unit.productId, dto.variantIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.variantIds) {
        await tx.rentalUnitVariant.deleteMany({ where: { unitId: id } });
        if (dto.variantIds.length) {
          await tx.rentalUnitVariant.createMany({ data: [...new Set(dto.variantIds)].map((variantId) => ({ unitId: id, variantId })) });
        }
      }
      return tx.rentalUnit.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.conditionNotes !== undefined ? { conditionNotes: dto.conditionNotes } : {}),
        },
      });
    });
    await this.audit.log('UNIT_UPDATED', 'RentalUnit', id, { from: { status: unit.status }, to: { status: updated.status }, variantIds: dto.variantIds, note: dto.note });
    return updated;
  }

  async addBlock(unitId: string, dto: CreateUnitBlockDto, actor: { id: string }) {
    const unit = await this.prisma.rentalUnit.findFirst({ where: { id: unitId, tenantId: this.tenantId } });
    if (!unit) throw new NotFoundException('Rental unit not found');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt > startsAt)) throw new BadRequestException('The block must end after it starts.');
    // Under the product booking lock so a block and a booking for the same dates never interleave.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${unit.productId}))`;
      const clash = await tx.rentalOrder.count({
        where: {
          tenantId: this.tenantId,
          rentalUnitId: unitId,
          status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED', 'ID_REJECTED'] },
          startDate: { lt: endsAt },
          returnDate: { gt: startsAt },
        },
      });
      if (clash > 0) throw new ConflictException('A booking on this unit overlaps those dates. Move the booking first.');
      const block = await tx.rentalUnitBlock.create({
        data: { tenantId: this.tenantId, unitId, startsAt, endsAt, reason: dto.reason, createdByAdminId: actor.id },
      });
      await this.audit.log('UNIT_BLOCKED', 'RentalUnit', unitId, { blockId: block.id, startsAt, endsAt, reason: dto.reason });
      return block;
    });
  }

  async removeBlock(blockId: string) {
    const block = await this.prisma.rentalUnitBlock.findFirst({ where: { id: blockId, tenantId: this.tenantId } });
    if (!block) throw new NotFoundException('Block not found');
    await this.prisma.rentalUnitBlock.delete({ where: { id: blockId } });
    await this.audit.log('UNIT_UNBLOCKED', 'RentalUnit', block.unitId, { blockId, startsAt: block.startsAt, endsAt: block.endsAt });
    return { removed: true };
  }
}
