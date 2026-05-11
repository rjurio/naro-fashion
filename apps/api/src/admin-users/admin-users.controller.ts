import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

// JwtStrategy.validate() returns { id, email, ... } — the AdminUser row.
// `sub` only exists on the raw JWT payload, NOT on req.user. Reading
// req.user.sub yields undefined, which silently defeats the
// self-modification guards in AdminUsersService (e.g. `if (id === performedById)`
// evaluates false when performedById is undefined). Always pull the id via
// `@CurrentUser('id')`.
@Controller('admin-users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
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
  findOne(@Param('id') id: string) {
    return this.adminUsersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAdminUserDto, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.create(dto, performedById);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.adminUsersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.remove(id, performedById);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string, @CurrentUser('id') performedById: string) {
    return this.adminUsersService.toggle(id, performedById);
  }

  @Patch(':id/unlock')
  unlock(@Param('id') id: string) {
    return this.adminUsersService.unlock(id);
  }

  @Post(':id/roles')
  assignRole(
    @Param('id') id: string,
    @Body() body: { roleId: string },
    @CurrentUser('id') performedById: string,
  ) {
    return this.adminUsersService.assignRole(id, body.roleId, performedById);
  }

  @Delete(':id/roles/:roleId')
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser('id') performedById: string,
  ) {
    return this.adminUsersService.removeRole(id, roleId, performedById);
  }

  @Get(':id/activity')
  getActivity(@Param('id') id: string) {
    return this.adminUsersService.getActivity(id);
  }
}
