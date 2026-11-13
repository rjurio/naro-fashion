import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { AVAILABILITY_RELEASING_STATUSES, isRentableProduct } from './rental-availability';
import { legacyConflicts, PlanBooking, PlanUnit, planUnitAllocation, SERVICEABLE_UNIT_STATUSES, unitSetHash } from './rental-unit-tracking';

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

export class RequestUnitTrackingDto {
  /** The physical count of this product's gowns in the shop (incl. those in cleaning / repair). */
  @IsInt() @Min(1) @Max(500) countedQuantity!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class DecideUnitTrackingDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class RejectUnitTrackingDto {
  @IsString() @IsNotEmpty() @MaxLength(500) note!: string;
}
export class DeactivateUnitTrackingDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * Physical rental units (POS rental MVP, M2 / R2). Registering units never
 * changes availability by itself: a product books by free VERIFIED gown only
 * after an independently approved physical count switches its tracking on
 * (requestTracking -> approveTracking); otherwise the legacy one-booking-at-a-
 * time rule applies. Every change is audited. Never touches sale stock.
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

  /** Active rental items (RENTAL_ONLY / BOTH) by name, SKU, barcode or gown tag. Read-only. */
  async catalog(q?: string) {
    const term = (q ?? '').trim();
    const products = await this.prisma.product.findMany({
      where: {
        tenantId: this.tenantId,
        isActive: true,
        deletedAt: null,
        archivedAt: null,
        availabilityMode: { in: ['RENTAL_ONLY', 'BOTH'] },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { variants: { some: { OR: [{ sku: { contains: term, mode: 'insensitive' } }, { barcode: term }] } } },
                { rentalUnits: { some: { code: term } } },
              ],
            }
          : {}),
      },
      select: {
        id: true, name: true, slug: true, availabilityMode: true,
        variants: { where: { isActive: true }, select: { id: true, name: true, sku: true } },
        _count: { select: { rentalUnits: true } },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return products.map((p) => ({ ...p, unitCount: p._count.rentalUnits }));
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
    // A counted gown whose sizes change, or that comes back into service, must
    // be counted again before it can be booked (it drops out of the verified
    // set; capacity only ever goes down until the next approved count).
    const resized = dto.variantIds !== undefined;
    const backInService = !!dto.status && ['RETIRED', 'SOLD', 'LOST'].includes(unit.status) && SERVICEABLE_UNIT_STATUSES.includes(dto.status);
    const unverify = !!unit.trackingVerifiedAt && (resized || backInService);
    if (unverify && resized) {
      const open = await this.prisma.rentalOrder.count({
        where: { tenantId: this.tenantId, rentalUnitId: id, status: { notIn: AVAILABILITY_RELEASING_STATUSES } },
      });
      if (open > 0) throw new ConflictException(`This gown has ${open} open booking(s); change its sizes after they are returned.`);
    }
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
          ...(unverify ? { trackingVerifiedAt: null } : {}),
        },
      });
    });
    await this.audit.log('UNIT_UPDATED', 'RentalUnit', id, {
      from: { status: unit.status }, to: { status: updated.status }, variantIds: dto.variantIds, note: dto.note, needsRecount: unverify,
    });
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

  // ----------------------------------------------------------- per-gown tracking (R2)
  private async product(productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, tenantId: this.tenantId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /** Gowns + open bookings + buffer, read inside the caller's transaction / lock. */
  private async trackingState(db: any, productId: string) {
    const product = await db.product.findFirst({ where: { id: productId, tenantId: this.tenantId } });
    const policy = await db.rentalPolicy.findFirst({ where: { tenantId: this.tenantId } });
    const bufferDays = product?.bufferDaysOverride ?? policy?.bufferDaysBetweenRentals ?? 7;
    const rows = await db.rentalUnit.findMany({
      where: { tenantId: this.tenantId, productId },
      include: { fits: { select: { variantId: true } }, blocks: { select: { startsAt: true, endsAt: true } } },
      orderBy: { code: 'asc' },
    });
    const serviceable: PlanUnit[] = rows
      .filter((u: any) => SERVICEABLE_UNIT_STATUSES.includes(u.status))
      .map((u: any) => ({ id: u.id, code: u.code, status: u.status, fits: u.fits.map((f: any) => f.variantId), blocks: u.blocks }));
    const bookings: PlanBooking[] = (
      await db.rentalOrder.findMany({
        where: { tenantId: this.tenantId, productId, status: { notIn: AVAILABILITY_RELEASING_STATUSES } },
        select: { id: true, rentalNumber: true, status: true, startDate: true, returnDate: true, actualReturnDate: true, variantId: true, rentalUnitId: true },
        orderBy: { startDate: 'asc' },
        take: 1000,
      })
    ).map((b: any) => ({ ...b, variantId: b.variantId ?? null, rentalUnitId: b.rentalUnitId ?? null }));
    return { product, bufferDays, rows, serviceable, bookings, hash: unitSetHash(serviceable) };
  }

  private async lockProduct(tx: any, productId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${productId}))`;
  }

  /** Status + dry-run for the admin screen. */
  async trackingStatus(productId: string) {
    await this.product(productId);
    const st = await this.trackingState(this.prisma, productId);
    const plan = planUnitAllocation(st.serviceable, st.bookings, st.bufferDays, new Date());
    const changes = await this.prisma.rentalUnitTrackingChange.findMany({
      where: { tenantId: this.tenantId, productId },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });
    return {
      productId,
      activatedAt: st.product.rentalUnitTrackingActivatedAt ?? null,
      mode: st.product.rentalUnitTrackingActivatedAt ? 'UNITS' : 'LEGACY',
      registered: st.rows.map((u: any) => ({ id: u.id, code: u.code, status: u.status, sizes: u.fits.map((f: any) => f.variantId), verified: !!u.trackingVerifiedAt })),
      serviceableCount: st.serviceable.length,
      unitsWithoutSizes: st.serviceable.filter((u) => u.fits.length === 0).map((u) => u.code),
      openBookings: st.bookings.length,
      preview: plan,
      openRequest: changes.find((c: any) => c.status === 'REQUESTED') ?? null,
      history: changes,
    };
  }

  /**
   * Step 1 (inventory manager): submit the physical count. Refused unless the
   * count equals the registered serviceable gowns, every gown has its sizes,
   * and every open booking can be placed on a gown. Nothing changes yet.
   */
  async requestTracking(productId: string, dto: RequestUnitTrackingDto, actor: { id: string }) {
    const product = await this.product(productId);
    if (!isRentableProduct(product)) throw new BadRequestException('Only an active rentable product can use per-gown tracking.');
    let mismatch: { counted: number; registered: number } | null = null;
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        await this.lockProduct(tx, productId);
        const open = await tx.rentalUnitTrackingChange.findFirst({ where: { tenantId: this.tenantId, productId, status: 'REQUESTED' } });
        if (open) throw new ConflictException({ statusCode: 409, code: 'TRACKING_REQUEST_OPEN', message: 'A count for this product is already waiting for approval.' });
        const st = await this.trackingState(tx, productId);
        if (st.serviceable.length === 0) {
          throw new BadRequestException('Register every physical gown (tag + sizes) before submitting the count.');
        }
        if (dto.countedQuantity !== st.serviceable.length) {
          mismatch = { counted: dto.countedQuantity, registered: st.serviceable.length };
          throw new ConflictException({
            statusCode: 409, code: 'COUNT_MISMATCH', counted: dto.countedQuantity, registered: st.serviceable.length,
            message: `You counted ${dto.countedQuantity} gown(s) but ${st.serviceable.length} are registered (in service or maintenance). Register or retire tags until they match.`,
          });
        }
        const noSizes = st.serviceable.filter((u) => u.fits.length === 0).map((u) => u.code);
        if (noSizes.length) {
          throw new ConflictException({ statusCode: 409, code: 'UNIT_SIZES_MISSING', units: noSizes, message: `Record the sizes for: ${noSizes.join(', ')}.` });
        }
        const plan = planUnitAllocation(st.serviceable, st.bookings, st.bufferDays, new Date());
        if (!plan.ok) {
          throw new ConflictException({
            statusCode: 409, code: 'ALLOCATION_IMPOSSIBLE', unplaced: plan.unplaced,
            message: 'Some open bookings could not be placed on a gown. Move them, or register the missing gowns.',
          });
        }
        const change = await tx.rentalUnitTrackingChange.create({
          data: {
            tenantId: this.tenantId, productId, action: 'ACTIVATE', status: 'REQUESTED',
            countedQuantity: dto.countedQuantity, unitIds: st.serviceable.map((u) => u.id), unitSetHash: st.hash,
            plan: plan as any, note: dto.note, requestedById: actor.id,
          },
        });
        await this.audit.log('UNIT_TRACKING_REQUESTED', 'Product', productId, { changeId: change.id, counted: dto.countedQuantity, units: st.serviceable.map((u) => u.code) });
        return change;
      });
    } finally {
      // Audited outside the rolled-back transaction.
      if (mismatch) await this.audit.log('UNIT_TRACKING_COUNT_MISMATCH', 'Product', productId, mismatch);
    }
  }

  private async loadChange(id: string) {
    const c = await this.prisma.rentalUnitTrackingChange.findFirst({ where: { id, tenantId: this.tenantId } });
    if (!c) throw new NotFoundException('Count request not found');
    return c;
  }

  /**
   * Step 2 (independent reviewer, never the person who counted): under the
   * product booking lock, re-check that the gown set is exactly what was
   * counted, re-plan every open booking, then allocate them, mark the counted
   * gowns verified and switch the product to per-gown tracking. Audited.
   */
  async approveTracking(id: string, dto: DecideUnitTrackingDto, actor: { id: string }) {
    const c = await this.loadChange(id);
    if (c.requestedById === actor.id) {
      await this.audit.log('UNIT_TRACKING_APPROVAL_DENIED', 'Product', c.productId, { changeId: id, reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'The count must be approved by a different person than the one who submitted it.' });
    }
    const result = await this.prisma.$transaction(async (tx: any) => {
      await this.lockProduct(tx, c.productId);
      const fresh = await tx.rentalUnitTrackingChange.findFirst({ where: { id, tenantId: this.tenantId } });
      if (!fresh || fresh.status !== 'REQUESTED') throw new ConflictException('This count is no longer waiting for approval. Reload.');
      const st = await this.trackingState(tx, c.productId);
      const plan = planUnitAllocation(st.serviceable, st.bookings, st.bufferDays, new Date());
      if (st.hash !== fresh.unitSetHash || !plan.ok) {
        return { stale: true as const, reason: st.hash !== fresh.unitSetHash ? 'GOWNS_CHANGED' : 'ALLOCATION_IMPOSSIBLE', plan };
      }
      const now = new Date();
      for (const a of plan.assignments.filter((x) => !x.kept)) {
        await tx.rentalOrder.updateMany({ where: { id: a.rentalId, tenantId: this.tenantId }, data: { rentalUnitId: a.unitId } });
      }
      await tx.rentalUnit.updateMany({ where: { tenantId: this.tenantId, productId: c.productId, id: { in: fresh.unitIds } }, data: { trackingVerifiedAt: now } });
      await tx.product.updateMany({
        where: { id: c.productId, tenantId: this.tenantId },
        data: { rentalUnitTrackingActivatedAt: st.product.rentalUnitTrackingActivatedAt ?? now },
      });
      const claimed = await tx.rentalUnitTrackingChange.updateMany({
        where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
        data: { status: 'APPLIED', decidedById: actor.id, decidedAt: now, decisionNote: dto.note, plan: plan as any },
      });
      if (claimed.count !== 1) throw new ConflictException('This count is no longer waiting for approval. Reload.');
      return { stale: false as const, plan };
    });
    if (result.stale) {
      await this.prisma.rentalUnitTrackingChange.updateMany({
        where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
        data: { status: 'STALE', decidedById: actor.id, decidedAt: new Date(), decisionNote: result.reason },
      });
      await this.audit.log('UNIT_TRACKING_STALE', 'Product', c.productId, { changeId: id, reason: result.reason, unplaced: result.plan.unplaced });
      throw new ConflictException({
        statusCode: 409, code: 'TRACKING_REQUEST_STALE', reason: result.reason, unplaced: result.plan.unplaced,
        message: result.reason === 'GOWNS_CHANGED'
          ? 'The gowns changed after the count was submitted. Count again and submit a new request.'
          : 'Some open bookings can no longer be placed on a gown. Nothing was changed.',
      });
    }
    await this.audit.log('UNIT_TRACKING_ACTIVATED', 'Product', c.productId, {
      changeId: id,
      requestedBy: c.requestedById,
      units: c.unitIds.length,
      allocated: result.plan.assignments.filter((a) => !a.kept).map((a) => `${a.rentalNumber}->${a.unitCode}`),
    });
    return this.loadChange(id);
  }

  async rejectTracking(id: string, dto: RejectUnitTrackingDto, actor: { id: string }) {
    const c = await this.loadChange(id);
    const r = await this.prisma.rentalUnitTrackingChange.updateMany({
      where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
      data: { status: 'REJECTED', decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note },
    });
    if (r.count !== 1) throw new ConflictException('This count is no longer waiting for approval. Reload.');
    await this.audit.log('UNIT_TRACKING_REJECTED', 'Product', c.productId, { changeId: id, note: dto.note });
    return this.loadChange(id);
  }

  async cancelTracking(id: string, actor: { id: string }) {
    const c = await this.loadChange(id);
    const r = await this.prisma.rentalUnitTrackingChange.updateMany({
      where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
      data: { status: 'CANCELLED', decidedById: actor.id, decidedAt: new Date() },
    });
    if (r.count !== 1) throw new ConflictException('This count is no longer waiting for approval. Reload.');
    await this.audit.log('UNIT_TRACKING_CANCELLED', 'Product', c.productId, { changeId: id });
    return this.loadChange(id);
  }

  /**
   * Roll back to the legacy one-booking-at-a-time rule (reviewer permission,
   * audited). Refused while two open bookings overlap, because the legacy rule
   * could not honour them. Counted gowns become uncounted; bookings keep their tag.
   */
  async deactivateTracking(productId: string, dto: DeactivateUnitTrackingDto, actor: { id: string }) {
    await this.product(productId);
    const change = await this.prisma.$transaction(async (tx: any) => {
      await this.lockProduct(tx, productId);
      const st = await this.trackingState(tx, productId);
      if (!st.product.rentalUnitTrackingActivatedAt) throw new ConflictException('Per-gown tracking is not active for this product.');
      const conflicts = legacyConflicts(st.bookings, st.bufferDays, new Date());
      if (conflicts.length) {
        throw new ConflictException({
          statusCode: 409, code: 'DEACTIVATION_CONFLICT', conflicts,
          message: 'These bookings overlap; the one-at-a-time rule could not honour them. Move them first.',
        });
      }
      const now = new Date();
      await tx.product.updateMany({ where: { id: productId, tenantId: this.tenantId }, data: { rentalUnitTrackingActivatedAt: null } });
      await tx.rentalUnit.updateMany({ where: { tenantId: this.tenantId, productId }, data: { trackingVerifiedAt: null } });
      const row = await tx.rentalUnitTrackingChange.create({
        data: {
          tenantId: this.tenantId, productId, action: 'DEACTIVATE', status: 'APPLIED', note: dto.reason,
          unitIds: [], requestedById: actor.id, decidedById: actor.id, decidedAt: now,
        },
      });
      return { row, openBookings: st.bookings.length };
    });
    await this.audit.log('UNIT_TRACKING_DEACTIVATED', 'Product', productId, { changeId: change.row.id, reason: dto.reason, openBookings: change.openBookings });
    return change.row;
  }
}
