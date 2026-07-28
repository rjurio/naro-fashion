import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';

// Role management is SUPER_ADMIN-only in practice (MANAGER is explicitly
// excluded from roles:manage). PermissionGuard enforces that; SUPER_ADMIN and
// platform admins bypass.
@Controller('roles')
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequiresPermission('roles:view')
  findAll(@Query('includeDeleted') includeDeleted?: string) {
    return this.rolesService.findAll(includeDeleted === 'true');
  }

  @Get(':id')
  @RequiresPermission('roles:view')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @RequiresPermission('roles:manage')
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequiresPermission('roles:manage')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('roles:manage')
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }

  @Patch(':id/restore')
  @RequiresPermission('roles:manage')
  restore(@Param('id') id: string) {
    return this.rolesService.restore(id);
  }

  @Get(':id/permissions')
  @RequiresPermission('roles:view')
  getPermissions(@Param('id') id: string) {
    return this.rolesService.getRolePermissions(id);
  }

  @Post(':id/permissions')
  @RequiresPermission('roles:manage')
  addPermissions(@Param('id') id: string, @Body() body: { permissionIds: string[] }) {
    return this.rolesService.addPermissions(id, body.permissionIds);
  }

  @Delete(':roleId/permissions/:permissionId')
  @RequiresPermission('roles:manage')
  removePermission(@Param('roleId') roleId: string, @Param('permissionId') permissionId: string) {
    return this.rolesService.removePermission(roleId, permissionId);
  }
}
