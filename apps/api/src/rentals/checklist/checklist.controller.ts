import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../../auth/guards/module.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { RequiresModule } from '../../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  DecideChecklistExceptionDto,
  RecordChecklistDto,
  RentalChecklistV2Service,
  RequestChecklistExceptionDto,
  ResolveDiscrepancyDto,
} from './checklist.service';

/**
 * R3 mandatory rental checklist. Part of the core rentals module (not the
 * optional "rental-checklists" module): hand-overs depend on it.
 *   read            rentals:view
 *   evidence        rentals:checklist-verify (records, exception requests, desk snapshot)
 *   decisions       rentals:checklist-exception (a different person: exceptions, discrepancies)
 *   backfill        rentals:checklist-templates
 */
@UseGuards(JwtAuthGuard, ModuleGuard, AdminGuard, PermissionGuard)
@RequiresModule('rentals')
@Controller('rental-checklist')
export class RentalChecklistV2Controller {
  constructor(private readonly svc: RentalChecklistV2Service) {}

  private actor(user: any) {
    if (!user?.id) throw new ForbiddenException();
    return user as { id: string };
  }

  @Get('rentals/:id')
  @RequiresPermission('rentals:view')
  state(@Param('id') id: string) {
    return this.svc.state(id);
  }

  @Post('rentals/:id/snapshot')
  @RequiresPermission('rentals:checklist-verify')
  freeze(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.freezeAtDesk(id, this.actor(user));
  }

  @Post('rentals/:id/records')
  @RequiresPermission('rentals:checklist-verify')
  record(@Param('id') id: string, @Body() dto: RecordChecklistDto, @CurrentUser() user: any) {
    return this.svc.record(id, dto, this.actor(user));
  }

  @Post('rentals/:id/exceptions')
  @RequiresPermission('rentals:checklist-verify')
  requestException(@Param('id') id: string, @Body() dto: RequestChecklistExceptionDto, @CurrentUser() user: any) {
    return this.svc.requestException(id, dto, this.actor(user));
  }

  @Patch('exceptions/:id/approve')
  @RequiresPermission('rentals:checklist-exception')
  approve(@Param('id') id: string, @Body() dto: DecideChecklistExceptionDto, @CurrentUser() user: any) {
    return this.svc.decideException(id, true, dto, this.actor(user));
  }

  @Patch('exceptions/:id/reject')
  @RequiresPermission('rentals:checklist-exception')
  reject(@Param('id') id: string, @Body() dto: DecideChecklistExceptionDto, @CurrentUser() user: any) {
    return this.svc.decideException(id, false, dto, this.actor(user));
  }

  @Patch('discrepancies/:id/resolve')
  @RequiresPermission('rentals:checklist-exception')
  resolve(@Param('id') id: string, @Body() dto: ResolveDiscrepancyDto, @CurrentUser() user: any) {
    return this.svc.resolveDiscrepancy(id, dto, this.actor(user));
  }

  @Post('backfill')
  @RequiresPermission('rentals:checklist-templates')
  backfill(@Query('dryRun') dryRun: string | undefined, @CurrentUser() user: any) {
    return this.svc.backfill(dryRun !== 'false', this.actor(user));
  }
}
