import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  IdVerificationService,
  SubmitIdVerificationDto,
  RejectVerificationDto,
} from './id-verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { ModuleGuard } from '../auth/guards/module.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';

@UseGuards(JwtAuthGuard, ModuleGuard)
@RequiresModule('id-verification')
@Controller('id-verification')
export class IdVerificationController {
  constructor(
    private readonly idVerificationService: IdVerificationService,
  ) {}

  // Customer-facing: a logged-in customer submits their own ID document.
  @Post('submit')
  submit(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitIdVerificationDto,
  ) {
    return this.idVerificationService.submit(userId, dto);
  }

  // Customer-facing: a logged-in customer checks their own verification status.
  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.idVerificationService.getStatus(userId);
  }

  // Staff with id-verification:review only (owner rule 2026-11-12: only
  // authorised staff review IDs). The queue shows customer contact details.
  // Admin only — moderation queue.
  @Get('pending')
  @UseGuards(AdminGuard, PermissionGuard)
  @RequiresPermission('id-verification:review')
  getPending() {
    return this.idVerificationService.getPending();
  }

  // Admin only — approve another user's submission.
  @Patch(':id/approve')
  @UseGuards(AdminGuard, PermissionGuard)
  @RequiresPermission('id-verification:review')
  approve(@Param('id') id: string) {
    return this.idVerificationService.approve(id);
  }

  // Admin only — reject another user's submission.
  @Patch(':id/reject')
  @UseGuards(AdminGuard, PermissionGuard)
  @RequiresPermission('id-verification:review')
  reject(@Param('id') id: string, @Body() dto: RejectVerificationDto) {
    return this.idVerificationService.reject(id, dto);
  }
}
