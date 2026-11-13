import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant.context';
import { AuditService } from '../../audit/audit.service';
import {
  CHECKLIST_STAGES,
  CONDITIONS,
  CONFIRMED_STATUSES,
  DISCREPANCY_RESOLUTIONS,
  checklistState,
  discrepanciesFor,
  freezeSnapshot,
  handoverUnresolved,
  inspectionGaps,
  lockChecklist,
  resolveTemplate,
} from './checklist-core';

export class ChecklistEntryDto {
  @IsString() @IsNotEmpty() @MaxLength(40) snapshotItemId!: string;
  @IsInt() @Min(0) @Max(1000) quantity!: number;
  @IsOptional() @IsIn(CONDITIONS as unknown as string[]) condition?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** A correction names the record it replaces (which must be the current one). */
  @IsOptional() @IsString() @MaxLength(40) supersedesId?: string;
}

export class RecordChecklistDto {
  @IsIn(CHECKLIST_STAGES as unknown as string[]) stage!: (typeof CHECKLIST_STAGES)[number];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistEntryDto)
  entries!: ChecklistEntryDto[];
}

export const EXCEPTION_KINDS = ['MISSING', 'SUBSTITUTED', 'NO_SNAPSHOT'] as const;
export class RequestChecklistExceptionDto {
  @IsIn(EXCEPTION_KINDS as unknown as string[]) kind!: (typeof EXCEPTION_KINDS)[number];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) snapshotItemIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) substituteNote?: string;
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

export class DecideChecklistExceptionDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ResolveDiscrepancyDto {
  @IsIn(DISCREPANCY_RESOLUTIONS as unknown as string[]) resolution!: (typeof DISCREPANCY_RESOLUTIONS)[number];
  @IsString() @MinLength(5) @MaxLength(1000) note!: string;
}

/** Statuses after the item has left the shop. */
const HANDED_OVER = ['ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED'];
const RETURN_STAGE_STATUSES = ['RETURNED', 'INSPECTION'];

/**
 * R3 mandatory checklist (owner-approved 2026-11-13, local implementation).
 * Rules in checklist-core.ts; this service is the HTTP-facing workflow:
 *
 *  - evidence (rentals:checklist-verify): append-only records under a
 *    per-booking advisory lock; a correction must name the CURRENT record it
 *    supersedes, so two people can never silently overwrite each other;
 *  - exceptions (requested with checklist-verify, decided with
 *    rentals:checklist-exception by someone else; the decider may not hand
 *    the item over);
 *  - discrepancies opened by return records, resolved by a reviewer
 *    (rentals:checklist-exception) who did not record that return.
 *
 * Every write is audited. Nothing here moves money or computes an amount.
 */
@Injectable()
export class RentalChecklistV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  private get tenantId() {
    return this.tenantContext.requireId;
  }

  private async loadRental(db: any, id: string) {
    const rental = await db.rentalOrder.findFirst({
      where: { id, tenantId: this.tenantId },
      select: { id: true, rentalNumber: true, status: true, rentalUnitId: true, productId: true, rentalUnit: { select: { code: true } } },
    });
    if (!rental) throw new NotFoundException('Rental order not found');
    return rental;
  }

  /** Everything the hand-over and return screens show. */
  async state(rentalOrderId: string) {
    const rental = await this.loadRental(this.prisma, rentalOrderId);
    const s = await checklistState(this.prisma, this.tenantId, rentalOrderId, rental.rentalUnitId ?? null);
    const handover = s.snapshot ? handoverUnresolved(s) : { unresolved: [], usedExceptions: [] };
    const inspection = inspectionGaps(s);
    const actorIds = [
      ...s.records.map((r: any) => r.recordedById),
      ...s.exceptions.flatMap((e: any) => [e.requestedById, e.decidedById, e.usedById]),
      ...s.discrepancies.map((d: any) => d.resolvedById),
      s.snapshot?.frozenById,
    ].filter(Boolean) as string[];
    const people = actorIds.length
      ? await this.prisma.adminUser.findMany({ where: { id: { in: [...new Set(actorIds)] } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const template = s.snapshot?.templateId
      ? await this.prisma.rentalChecklistTemplate.findFirst({ where: { id: s.snapshot.templateId, tenantId: this.tenantId }, select: { name: true, version: true } })
      : null;
    return {
      rental: { id: rental.id, rentalNumber: rental.rentalNumber, status: rental.status, rentalUnitId: rental.rentalUnitId, unitCode: rental.rentalUnit?.code ?? null },
      snapshot: s.snapshot ? { ...s.snapshot, items: undefined, templateName: template?.name ?? null, currentTemplateVersion: template?.version ?? null } : null,
      items: s.items,
      exceptions: s.exceptions,
      discrepancies: s.discrepancies,
      records: s.records,
      handover: {
        stageOpen: !HANDED_OVER.includes(rental.status) && rental.status !== 'CANCELLED',
        unresolved: s.snapshot ? handover.unresolved : ['CHECKLIST_SNAPSHOT'],
        coveredByExceptions: handover.usedExceptions,
      },
      inspection: {
        stageOpen: RETURN_STAGE_STATUSES.includes(rental.status),
        complete: !!s.snapshot && inspection.notInspected.length === 0,
        notInspected: inspection.notInspected,
        openDiscrepancies: inspection.open.map((d: any) => d.id),
      },
      people: Object.fromEntries(people.map((p: any) => [p.id, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()])),
      // Owner-authorised database gate overrides on this booking (read-only; see GATE_RECOVERY_PROCEDURE.md).
      gateOverrides: this.prisma.rentalGateOverride?.findMany
        ? await this.prisma.rentalGateOverride.findMany({ where: { rentalOrderId, rentalOrder: { tenantId: this.tenantId } }, orderBy: { createdAt: 'asc' } })
        : [],
    };
  }

  /** Every owner-authorised gate override in this shop (read-only audit view). */
  async gateOverrides() {
    return this.prisma.rentalGateOverride.findMany({
      where: { rentalOrder: { tenantId: this.tenantId } },
      include: { rentalOrder: { select: { rentalNumber: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Freeze the checklist at the desk for a booking that has none (confirmed
   * before R3, or the automatic freeze failed). Uses today's template;
   * recorded as LEGACY_DESK with the person and time.
   */
  async freezeAtDesk(rentalOrderId: string, actor: { id: string }) {
    const rental = await this.loadRental(this.prisma, rentalOrderId);
    if (![...CONFIRMED_STATUSES, ...HANDED_OVER].includes(rental.status) || rental.status === 'CLOSED') {
      throw new ConflictException({
        statusCode: 409, code: 'NOT_CONFIRMED',
        message: 'The checklist is fixed when the booking is confirmed. This booking is not confirmed (or already closed).',
      });
    }
    const res = await this.prisma.$transaction(async (tx) => {
      await lockChecklist(tx, rentalOrderId);
      return freezeSnapshot(tx, this.tenantId, rentalOrderId, actor.id, true);
    });
    if (!res.created) throw new ConflictException({ statusCode: 409, code: 'SNAPSHOT_EXISTS', message: 'This booking already has its checklist.' });
    await this.audit.log('CHECKLIST_SNAPSHOT_FROZEN', 'Rental', rentalOrderId, { source: 'LEGACY_DESK', snapshotId: res.snapshot?.id, templateId: res.snapshot?.templateId ?? null });
    return this.state(rentalOrderId);
  }

  async record(rentalOrderId: string, dto: RecordChecklistDto, actor: { id: string }) {
    const tenantId = this.tenantId;
    const ids = dto.entries.map((e) => e.snapshotItemId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each item can appear only once per submission.');

    const out = await this.prisma.$transaction(async (tx) => {
      await lockChecklist(tx, rentalOrderId);
      const rental = await this.loadRental(tx, rentalOrderId);
      if (dto.stage === 'HANDOVER' && (HANDED_OVER.includes(rental.status) || rental.status === 'CANCELLED')) {
        throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_STAGE_CLOSED', message: 'Hand-over evidence can no longer be changed: the item has left the shop (or the booking is cancelled).' });
      }
      if (dto.stage === 'RETURN' && !RETURN_STAGE_STATUSES.includes(rental.status)) {
        throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_STAGE_CLOSED', message: 'Return inspection is recorded after the return is registered and before the rental is closed.' });
      }
      const s = await checklistState(tx, tenantId, rentalOrderId, rental.rentalUnitId ?? null);
      if (!s.snapshot) throw new ConflictException({ statusCode: 409, code: 'NO_SNAPSHOT', message: 'This booking has no checklist yet. Create it at the desk first.' });

      const created: any[] = [];
      const opened: any[] = [];
      for (const e of dto.entries) {
        const item = s.items.find((i: any) => i.id === e.snapshotItemId);
        if (!item) throw new BadRequestException(`Unknown checklist item ${e.snapshotItemId}.`);
        if (dto.stage === 'HANDOVER' && item.stage !== 'BOTH') throw new BadRequestException(`"${item.label}" is checked on return only.`);
        if (item.requiresCondition && !e.condition) throw new BadRequestException(`"${item.label}": record its condition.`);
        const current = dto.stage === 'HANDOVER' ? item.handover : item.return;
        if ((e.supersedesId ?? null) !== (current?.id ?? null)) {
          throw new ConflictException({
            statusCode: 409, code: 'CHECKLIST_CHANGED', itemId: item.id, currentRecordId: current?.id ?? null,
            message: `"${item.label}" was recorded by someone else meanwhile. Reload and review before correcting it.`,
          });
        }
        let rec: any;
        try {
          rec = await tx.rentalChecklistRecord.create({
            data: {
              tenantId, rentalOrderId, snapshotItemId: item.id, stage: dto.stage, quantity: e.quantity,
              condition: e.condition ?? null, note: e.note ?? null, recordedById: actor.id,
              supersedesId: e.supersedesId ?? null, rentalUnitId: rental.rentalUnitId ?? null,
            },
          });
        } catch (err: any) {
          if (err?.code === 'P2002') throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_CHANGED', message: 'That record was already corrected by someone else. Reload.' });
          throw err;
        }
        created.push(rec);
        if (dto.stage === 'RETURN') {
          if (e.supersedesId) {
            await tx.rentalDiscrepancy.updateMany({ where: { tenantId, rentalOrderId, recordId: e.supersedesId, status: 'OPEN' }, data: { status: 'SUPERSEDED' } });
          }
          for (const d of discrepanciesFor(item, item.handover, rec)) {
            opened.push(await tx.rentalDiscrepancy.create({
              data: { tenantId, rentalOrderId, snapshotItemId: item.id, recordId: rec.id, kind: d.kind, quantity: d.quantity, note: e.note ?? null },
            }));
          }
        }
      }
      return { created, opened };
    });
    await this.audit.log('CHECKLIST_RECORDED', 'Rental', rentalOrderId, {
      stage: dto.stage,
      records: out.created.map((r: any) => ({ id: r.id, item: r.snapshotItemId, quantity: r.quantity, condition: r.condition, supersedes: r.supersedesId })),
    });
    for (const d of out.opened) {
      await this.audit.log('DISCREPANCY_OPENED', 'RentalDiscrepancy', d.id, { rentalOrderId, kind: d.kind, quantity: d.quantity, item: d.snapshotItemId });
    }
    return this.state(rentalOrderId);
  }

  async requestException(rentalOrderId: string, dto: RequestChecklistExceptionDto, actor: { id: string }) {
    const rental = await this.loadRental(this.prisma, rentalOrderId);
    if (HANDED_OVER.includes(rental.status) || rental.status === 'CANCELLED') {
      throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_STAGE_CLOSED', message: 'Exceptions are for the hand-over, which has already happened (or the booking is cancelled).' });
    }
    const s = await checklistState(this.prisma, this.tenantId, rentalOrderId, rental.rentalUnitId ?? null);
    const itemIds = [...new Set(dto.snapshotItemIds ?? [])];
    if (dto.kind === 'NO_SNAPSHOT') {
      if (s.items.length > 0) throw new BadRequestException('This booking has a checklist: request an exception for specific items instead.');
      if (itemIds.length) throw new BadRequestException('A "no checklist" exception names no items.');
    } else {
      if (!itemIds.length) throw new BadRequestException('Name the items the exception is for.');
      for (const id of itemIds) {
        const item = s.items.find((i: any) => i.id === id);
        if (!item || item.stage !== 'BOTH' || !item.isMandatory) throw new BadRequestException('Exceptions cover mandatory hand-over items of this booking only.');
      }
      if (dto.kind === 'SUBSTITUTED' && !dto.substituteNote?.trim()) throw new BadRequestException('Describe what is handed over instead.');
    }
    const created = await this.prisma.rentalChecklistException.create({
      data: {
        tenantId: this.tenantId, rentalOrderId, kind: dto.kind, snapshotItemIds: itemIds,
        substituteNote: dto.substituteNote?.trim() || null, reason: dto.reason.trim(), requestedById: actor.id,
      },
    });
    await this.audit.log('CHECKLIST_EXCEPTION_REQUESTED', 'RentalChecklistException', created.id, { rentalOrderId, kind: dto.kind, items: itemIds, reason: dto.reason.trim() });
    return created;
  }

  async decideException(id: string, approve: boolean, dto: DecideChecklistExceptionDto, actor: { id: string }) {
    const ex = await this.prisma.rentalChecklistException.findFirst({ where: { id, tenantId: this.tenantId } });
    if (!ex) throw new NotFoundException('Exception not found');
    if (ex.requestedById === actor.id) {
      await this.audit.log('CHECKLIST_EXCEPTION_DENIED', 'RentalChecklistException', id, { reason: 'SELF_APPROVAL' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'An exception must be decided by a different person than the one who requested it.' });
    }
    const rental = await this.loadRental(this.prisma, ex.rentalOrderId);
    if (approve && (HANDED_OVER.includes(rental.status) || rental.status === 'CANCELLED')) {
      throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_STAGE_CLOSED', message: 'The hand-over has already happened (or the booking is cancelled).' });
    }
    const res = await this.prisma.rentalChecklistException.updateMany({
      where: { id, tenantId: this.tenantId, status: 'REQUESTED' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.id, decidedAt: new Date(), decisionNote: dto.note?.trim() || null },
    });
    if (res.count === 0) throw new ConflictException('The exception is no longer waiting for a decision. Reload.');
    await this.audit.log(approve ? 'CHECKLIST_EXCEPTION_APPROVED' : 'CHECKLIST_EXCEPTION_REJECTED', 'RentalChecklistException', id, {
      rentalOrderId: ex.rentalOrderId, kind: ex.kind, items: ex.snapshotItemIds, note: dto.note ?? null,
    });
    return this.prisma.rentalChecklistException.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  async resolveDiscrepancy(id: string, dto: ResolveDiscrepancyDto, actor: { id: string }) {
    const d = await this.prisma.rentalDiscrepancy.findFirst({ where: { id, tenantId: this.tenantId } });
    if (!d) throw new NotFoundException('Discrepancy not found');
    const rec = await this.prisma.rentalChecklistRecord.findFirst({ where: { id: d.recordId, tenantId: this.tenantId }, select: { recordedById: true } });
    if (rec?.recordedById === actor.id) {
      await this.audit.log('DISCREPANCY_RESOLUTION_DENIED', 'RentalDiscrepancy', id, { reason: 'SELF_REVIEW' });
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_REVIEW', message: 'A discrepancy is reviewed by someone other than the person who recorded the return.' });
    }
    const rental = await this.loadRental(this.prisma, d.rentalOrderId);
    if (!RETURN_STAGE_STATUSES.includes(rental.status)) {
      throw new ConflictException({ statusCode: 409, code: 'CHECKLIST_STAGE_CLOSED', message: 'Discrepancies are reviewed before the rental is closed.' });
    }
    const res = await this.prisma.$transaction(async (tx) => {
      await lockChecklist(tx, d.rentalOrderId);
      return tx.rentalDiscrepancy.updateMany({
        where: { id, tenantId: this.tenantId, status: 'OPEN' },
        data: { status: dto.resolution, resolutionNote: dto.note.trim(), resolvedById: actor.id, resolvedAt: new Date() },
      });
    });
    if (res.count === 0) throw new ConflictException('The discrepancy is no longer open. Reload.');
    await this.audit.log('DISCREPANCY_RESOLVED', 'RentalDiscrepancy', id, { rentalOrderId: d.rentalOrderId, kind: d.kind, resolution: dto.resolution, note: dto.note.trim() });
    return this.prisma.rentalDiscrepancy.findFirst({ where: { id, tenantId: this.tenantId } });
  }

  /**
   * Backfill (requirement 14): give every confirmed or handed-over booking
   * that has no checklist one, from today's templates, recorded as
   * LEGACY_DESK. dryRun lists what would happen and writes nothing.
   */
  async backfill(dryRun: boolean, actor: { id: string }) {
    const tenantId = this.tenantId;
    const statuses = [...CONFIRMED_STATUSES, 'ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION'];
    const rentals = await this.prisma.rentalOrder.findMany({
      where: { tenantId, status: { in: statuses }, checklistSnapshot: { is: null } },
      select: { id: true, rentalNumber: true, status: true, product: { select: { id: true, categoryId: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const plan = [] as Array<{ id: string; rentalNumber: string; status: string; source: string; templateId: string | null; items: number }>;
    for (const r of rentals) {
      const { template, source } = await resolveTemplate(this.prisma, tenantId, r.product as any);
      plan.push({ id: r.id, rentalNumber: r.rentalNumber, status: r.status, source, templateId: template?.id ?? null, items: template?.items?.length ?? 0 });
    }
    if (dryRun) return { dryRun: true, bookings: plan };
    let frozen = 0;
    for (const p of plan) {
      const res = await this.prisma.$transaction(async (tx) => {
        await lockChecklist(tx, p.id);
        return freezeSnapshot(tx, tenantId, p.id, actor.id, true);
      });
      if (res.created) frozen++;
    }
    await this.audit.log('CHECKLIST_BACKFILL', 'Tenant', tenantId, { frozen, bookings: plan.map((p) => p.rentalNumber) });
    return { dryRun: false, frozen, bookings: plan };
  }
}
