import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('permissions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  findAll(@Query('module') module?: string) {
    return this.permissionsService.findAll(module);
  }

  @Get('modules')
  getModules() {
    return this.permissionsService.getModules();
  }
}
