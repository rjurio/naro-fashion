import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('expenses')
@UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
@RequiresModule('expenses')
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  findAll(
    @Query('categoryId') categoryId?: string,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('vendor') vendor?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({ categoryId, period, startDate, endDate, vendor, page: page ? +page : 1, limit: limit ? +limit : 25 });
  }

  @Get('summary')
  getSummary(@Query('period') period: string) { return this.service.getSummary(period); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser('id') createdBy: string) {
    return this.service.create(dto, createdBy);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) { return this.service.update(id, dto); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
