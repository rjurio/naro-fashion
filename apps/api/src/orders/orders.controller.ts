import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrdersDto, AdminQueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('id') userId: string,
    @Query() query: QueryOrdersDto,
  ) {
    return this.ordersService.findAll(userId, query);
  }

  @UseGuards(AdminGuard)
  @Get('admin')
  findAllAdmin(@Query() query: AdminQueryOrdersDto) {
    return this.ordersService.findAllAdmin(query);
  }

  @UseGuards(AdminGuard)
  @Get('stats')
  getStats() {
    return this.ordersService.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ordersService.findOne(id, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.ordersService.updateStatus(id, dto.status, user);
  }
}
