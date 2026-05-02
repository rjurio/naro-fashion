import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  PaymentMethodsService,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './payment-methods.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Public()
  @Get()
  findAll() {
    return this.paymentMethodsService.findAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin')
  findAllAdmin() {
    return this.paymentMethodsService.findAllAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('deleted')
  findDeleted() {
    return this.paymentMethodsService.findDeleted();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.paymentMethodsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.paymentMethodsService.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.paymentMethodsService.softDelete(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.paymentMethodsService.restore(id);
  }
}
