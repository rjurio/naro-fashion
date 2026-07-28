import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

// JwtStrategy.validate() returns { id, email, ... } — the AdminUser row.
// `sub` only exists on the raw JWT payload, NOT on req.user. Reading
// req.user.sub yields undefined, which silently defeats the
// self-modification guards in AdminUsersService (e.g. `if (id === performedById)`
// evaluates false when performedById is undefined). Always pull the id via
// `@CurrentUser('id')`.
//
// PermissionGuard enforces per-action RBAC codes on top of AdminGuard so a
// STAFF/MANAGER admin can't create/promote admins (SUPER_ADMIN bypasses).
@Controller('admin-users')
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequiresPermission('admins:view')
  findAll(
    @Query('isActive') isActive?: string,
    @Query('role') role?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    return this.adminUsersService.findAll({
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      role,
      includeDeleted: includeDeleted === 'true',
    });
  }

  @Get(':id')
  @RequiresPermission('admins:view')
  findOne(@Param('id') id: string) {
    return this.adminUsersService.findOne(id);
  }

  @Post()
  @RequiresPermission('admins:create')
  create(@Body() dto: CreateAdminUserDto, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.create(dto, performedById);
  }

  @Patch(':id')
  @RequiresPermission('admins:update')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.adminUsersService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermission('admins:delete')
  remove(@Param('id') id: string, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.remove(id, performedById);
  }

  @Patch(':id/toggle')
  @RequiresPermission('admins:update')
  toggle(@Param('id') id: string, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.toggle(id, performedById);
  }

  @Patch(':id/unlock')
  @RequiresPermission('admins:unlock')
  unlock(@Param('id') id: string) {
    return this.adminUsersService.unlock(id);
  }

  @Post(':id/roles')
  @RequiresPermission('roles:manage')
  assignRole(
    @Param('id') id: string,
    @Body() body: { roleId: string },
    @CurrentUser('id') performedById: string,
  ) {
    return this.adminUsersService.assignRole(id, body.roleId, performedById);
  }

  @Delete(':id/roles/:roleId')
  @RequiresPermission('roles:manage')
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser('id') performedById: string,
  ) {
    return this.adminUsersService.removeRole(id, roleId, performedById);
  }

  @Get(':id/activity')
  @RequiresPermission('admins:view')
  getActivity(@Param('id') id: string) {
    return this.adminUsersService.getActivity(id);
  }
}
