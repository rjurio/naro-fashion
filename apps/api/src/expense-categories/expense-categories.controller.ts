import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('expense-categories')
@UseGuards(JwtAuthGuard)
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
  create(@Body() dto: CreateExpenseCategoryDto) { return this.service.create(dto); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) { return this.service.update(id, dto); }

  @Patch(':id/toggle')
  toggle(@Param('id') id: string) { return this.service.toggle(id); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/restore')
  restore(@Param('id') id: string) { return this.service.restore(id); }
}
