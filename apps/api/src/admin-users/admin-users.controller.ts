import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('admin-users')
@UseGuards(JwtAuthGuard)
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
  create(@Body() dto: CreateAdminUserDto, @Request() req: any) {
    return this.adminUsersService.create(dto, req.user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.adminUsersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.adminUsersService.remove(id, req.user.sub);
  }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string, @Request() req: any) {
    return this.adminUsersService.toggle(id, req.user.sub);
  }

  @Patch(':id/unlock')
  unlock(@Param('id') id: string) {
    return this.adminUsersService.unlock(id);
  }

  @Post(':id/roles')
  assignRole(@Param('id') id: string, @Body() body: { roleId: string }, @Request() req: any) {
    return this.adminUsersService.assignRole(id, body.roleId, req.user.sub);
  }

  @Delete(':id/roles/:roleId')
  removeRole(@Param('id') id: string, @Param('roleId') roleId: string, @Request() req: any) {
    return this.adminUsersService.removeRole(id, roleId, req.user.sub);
  }

  @Get(':id/activity')
  getActivity(@Param('id') id: string) {
    return this.adminUsersService.getActivity(id);
  }
}
