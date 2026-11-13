import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  GoneException,
} from '@nestjs/common';
import { RentalChecklistsService } from './rental-checklists.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { AssignChecklistDto } from './dto/assign-checklist.dto';
import { CheckItemDto } from './dto/check-item.dto';
import { ApproveTemplateDto, WithdrawTemplateDto } from './dto/approve-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';

const V1_GONE = {
  statusCode: 410,
  code: 'CHECKLIST_V1_RETIRED',
  message: 'The old tick-box checklist was retired: each booking now gets its checklist automatically at confirmation (see /rental-checklist/rentals/:id).',
};

/**
 * Checklist TEMPLATES (R3: product -> category -> shop default; reads
 * rentals:view, edits rentals:checklist-templates). Part of the core rentals
 * module: the R3 hand-over gate depends on them. The v1 per-booking
 * assign / check / uncheck routes are retired (410): evidence is append-only
 * in /rental-checklist (rentals/checklist/).
 */
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard, PermissionGuard)
@RequiresModule('rentals')
@Controller('rental-checklists')
export class RentalChecklistsController {
  constructor(
    private readonly rentalChecklistsService: RentalChecklistsService,
  ) {}

  @Get('templates')
  @RequiresPermission('rentals:view', 'rentals:manage-checklist', 'rentals:checklist-templates')
  getTemplates() {
    return this.rentalChecklistsService.getTemplates();
  }

  @Post('templates')
  @RequiresPermission('rentals:checklist-templates')
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser('id') actorId: string) {
    return this.rentalChecklistsService.createTemplate(dto, actorId);
  }

  @Get('templates/active')
  @RequiresPermission('rentals:view', 'rentals:manage-checklist', 'rentals:checklist-templates')
  getActiveTemplates() {
    return this.rentalChecklistsService.getActiveTemplates();
  }

  @Get('templates/:id')
  @RequiresPermission('rentals:view', 'rentals:manage-checklist', 'rentals:checklist-templates')
  getTemplate(@Param('id') id: string) {
    return this.rentalChecklistsService.getTemplate(id);
  }

  @Put('templates/:id')
  @RequiresPermission('rentals:checklist-templates')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @CurrentUser('id') actorId: string) {
    return this.rentalChecklistsService.updateTemplate(id, dto, actorId);
  }

  /** Round 25F D: a DIFFERENT person approves the exact version (hash) after verifying every item + quantity. */
  @Post('templates/:id/approve')
  @RequiresPermission('rentals:checklist-approve')
  approveTemplate(@Param('id') id: string, @Body() dto: ApproveTemplateDto, @CurrentUser('id') actorId: string) {
    return this.rentalChecklistsService.approveTemplate(id, dto, { id: actorId });
  }

  /** Round 25F D: stop using a template for new bookings (audited; existing snapshots untouched). */
  @Post('templates/:id/withdraw')
  @RequiresPermission('rentals:checklist-approve', 'rentals:checklist-templates')
  withdrawTemplate(@Param('id') id: string, @Body() dto: WithdrawTemplateDto, @CurrentUser('id') actorId: string) {
    return this.rentalChecklistsService.withdrawTemplate(id, dto, { id: actorId });
  }

  @Delete('templates/:id')
  @RequiresPermission('rentals:checklist-templates')
  deleteTemplate(@Param('id') id: string) {
    return this.rentalChecklistsService.deleteTemplate(id);
  }

  @Patch('templates/:id/toggle-active')
  @RequiresPermission('rentals:checklist-templates')
  toggleActive(@Param('id') id: string) {
    return this.rentalChecklistsService.toggleActive(id);
  }

  @Patch('templates/:id/restore')
  @RequiresPermission('rentals:checklist-templates')
  restoreTemplate(@Param('id') id: string) {
    return this.rentalChecklistsService.restoreTemplate(id);
  }

  @Get('templates-deleted')
  @RequiresPermission('rentals:view', 'rentals:manage-checklist', 'rentals:checklist-templates')
  findDeletedTemplates() {
    return this.rentalChecklistsService.findDeletedTemplates();
  }

  @Post('assign')
  @RequiresPermission('rentals:view')
  assignToRental(@Body() _dto: AssignChecklistDto): never {
    throw new GoneException(V1_GONE);
  }

  /** Legacy v1 entries of a booking (read-only history). */
  @Get('rental/:rentalOrderId')
  @RequiresPermission('rentals:view')
  getRentalChecklist(@Param('rentalOrderId') rentalOrderId: string) {
    return this.rentalChecklistsService.getRentalChecklist(rentalOrderId);
  }

  @Patch('entries/:entryId/check')
  @RequiresPermission('rentals:view')
  checkItem(
    @Param('entryId') _entryId: string,
    @CurrentUser('id') _adminUserId: string,
    @Body() _dto: CheckItemDto,
  ): never {
    throw new GoneException(V1_GONE);
  }

  @Patch('entries/:entryId/uncheck')
  @RequiresPermission('rentals:view')
  uncheckItem(@Param('entryId') _entryId: string): never {
    throw new GoneException(V1_GONE);
  }
}
