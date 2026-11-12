import { Body, Controller, ForbiddenException, Get, Injectable, Put, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * R1 rollback safety switch (owner-approved 2026-11-12).
 *
 * R3 (mandatory handover / return checklist) sets
 * RentalHandoverSafeguard.checklistRequired = true for each shop when it
 * ships. A build WITHOUT the checklist gate (this one: R1 / R2) must then
 * refuse EVERY rental handover instead of silently letting gowns leave
 * unchecked — so rolling R3 back can never remove the safeguard.
 *
 *  - Fail closed: an unreadable switch blocks handovers too.
 *  - One choke point: RentalsService.assertReleasable, which updateStatus calls
 *    for every hand-over transition (admin status change, POS handover,
 *    offline replays; the "single rental-status writer" shape spec keeps it so).
 *  - Purchases are never affected: only the rental hand-over transition checks it.
 *  - Changing it: PUT /rental-handover-safeguard, new permission
 *    `rentals:handover-safeguard` (never auto-granted), reason required,
 *    audited with before / after. Not a SiteSetting: the generic CMS settings
 *    endpoint (cms:manage) can't touch it, and the public settings list can't
 *    show it.
 */
export const CHECKLIST_ENFORCEMENT_AVAILABLE = false; // R3 sets true together with its checklist gate

export const HANDOVER_REQUIRES_CHECKLIST_BUILD = 'HANDOVER_REQUIRES_CHECKLIST_BUILD';
/**
 * R3's migration creates this table (design: POS_RENTAL_LAUNCH_PLAN.md §3.2).
 * Migrations are expand-only and never rolled back with the code, so its mere
 * EXISTENCE proves R3 has been deployed — even if the switch row below were
 * missing, deleted or never written. R3 must keep this exact table name.
 */
export const R3_MARKER_TABLE = 'RentalChecklistSnapshot';
export const HANDOVER_SAFEGUARD_UNAVAILABLE = 'HANDOVER_SAFEGUARD_UNAVAILABLE';

/** Throws (422) when this build may not hand items over. Never throws for purchases (not called there). */
export async function assertHandoverSafeguard(db: any, tenantId: string, buildHasChecklist = CHECKLIST_ENFORCEMENT_AVAILABLE): Promise<void> {
  let row: { checklistRequired: boolean } | null = null;
  let r3Deployed = false;
  try {
    row = await db.rentalHandoverSafeguard.findFirst({ where: { tenantId }, select: { checklistRequired: true } });
    // Second, independent signal (fail closed on "missing configuration"):
    // R3's table exists → the checklist era has begun for this database.
    if (typeof db.$queryRaw === 'function' && !buildHasChecklist) {
      const found: Array<{ t: string | null }> = await db.$queryRaw`SELECT to_regclass(${'"' + R3_MARKER_TABLE + '"'})::text AS t`;
      r3Deployed = !!found?.[0]?.t;
    }
  } catch {
    throw new UnprocessableEntityException({
      statusCode: 422, code: HANDOVER_SAFEGUARD_UNAVAILABLE,
      message: "The hand-over safety check couldn't be read, so nothing can be handed over. Try again; if it persists, contact the owner.",
    });
  }
  if ((row?.checklistRequired || r3Deployed) && !buildHasChecklist) {
    throw new UnprocessableEntityException({
      statusCode: 422, code: HANDOVER_REQUIRES_CHECKLIST_BUILD,
      message: 'Hand-overs need the mandatory checklist, which this version of the system does not have (it was rolled back). Nothing can be handed over until the checklist version is restored or the owner records an exception.',
    });
  }
}

export class SetHandoverSafeguardDto {
  @IsBoolean() checklistRequired!: boolean;
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}

@Injectable()
export class HandoverSafeguardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const tenantId = this.tenantContext.requireId;
    const row = await this.prisma.rentalHandoverSafeguard.findFirst({ where: { tenantId } });
    // The same check hand-overs use (switch OR R3 marker table, fail closed).
    let handoversAllowed = true;
    let blockedBy: string | null = null;
    try {
      await assertHandoverSafeguard(this.prisma, tenantId);
    } catch (e: any) {
      handoversAllowed = false;
      blockedBy = e?.getResponse?.()?.code ?? 'UNKNOWN';
    }
    return {
      checklistRequired: !!row?.checklistRequired,
      buildHasChecklist: CHECKLIST_ENFORCEMENT_AVAILABLE,
      handoversAllowed,
      blockedBy,
      changedAt: row?.changedAt ?? null,
      changedById: row?.changedById ?? null,
      reason: row?.reason ?? null,
    };
  }

  async set(dto: SetHandoverSafeguardDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const before = await this.prisma.rentalHandoverSafeguard.findFirst({ where: { tenantId } });
    if (before && before.checklistRequired === dto.checklistRequired) {
      return this.get();
    }
    const data = { checklistRequired: dto.checklistRequired, reason: dto.reason.trim(), changedById: actor.id, changedAt: new Date() };
    if (before) await this.prisma.rentalHandoverSafeguard.updateMany({ where: { id: before.id, tenantId }, data });
    else await this.prisma.rentalHandoverSafeguard.create({ data: { tenantId, ...data } });
    await this.audit.log('HANDOVER_SAFEGUARD_CHANGED', 'RentalHandoverSafeguard', tenantId, {
      before: before?.checklistRequired ?? false, after: dto.checklistRequired, reason: dto.reason.trim(), buildHasChecklist: CHECKLIST_ENFORCEMENT_AVAILABLE,
    });
    return this.get();
  }
}

@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
@Controller('rental-handover-safeguard')
export class HandoverSafeguardController {
  constructor(private readonly svc: HandoverSafeguardService) {}

  @Get()
  @RequiresPermission('rentals:view', 'rentals:handover-safeguard')
  get() {
    return this.svc.get();
  }

  @Put()
  @RequiresPermission('rentals:handover-safeguard')
  set(@Body() dto: SetHandoverSafeguardDto, @CurrentUser() user: any) {
    if (!user?.id) throw new ForbiddenException();
    return this.svc.set(dto, user);
  }
}
