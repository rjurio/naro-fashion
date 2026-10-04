import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';

// Reads stay open to any admin (the expenses form needs the category list for
// STAFF); every mutation requires 'expense-categories:manage'.
@Controller('expense-categories')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard, PermissionGuard)
@RequiresModule('expenses')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  @Get()
  findAll(@Query('isActive') isActive?: string, @Query('includeDeleted') includeDeleted?: string) {
    return this.service.findAll({
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      includeDeleted: includeDeleted === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @RequiresPermission('expense-categories:manage')
  create(@Body() dto: CreateExpenseCategoryDto) { return this.service.create(dto); }

  @Patch(':id')
  @RequiresPermission('expense-categories:manage')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) { return this.service.update(id, dto); }

  @Patch(':id/toggle')
  @RequiresPermission('expense-categories:manage')
  toggle(@Param('id') id: string) { return this.service.toggle(id); }

  @Delete(':id')
  @RequiresPermission('expense-categories:manage')
  remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/restore')
  @RequiresPermission('expense-categories:manage')
  restore(@Param('id') id: string) { return this.service.restore(id); }
}
