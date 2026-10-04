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
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Public } from '../auth/decorators/public.decorator';

// Every admin route here can read (masked) or write gateway credentials
// (integrationParams / integrationKey), so AdminGuard alone (any STAFF admin)
// is not enough — require the explicit 'payment-methods:manage' permission.
// SUPER_ADMIN and platform admins bypass via PermissionGuard.
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Public()
  @Get()
  findAll() {
    return this.paymentMethodsService.findAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Get('admin')
  findAllAdmin() {
    return this.paymentMethodsService.findAllAdmin();
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Get('deleted')
  findDeleted() {
    return this.paymentMethodsService.findDeleted();
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Post()
  create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodsService.create(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.paymentMethodsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Patch(':id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.paymentMethodsService.toggleActive(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.paymentMethodsService.softDelete(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
  @RequiresPermission('payment-methods:manage')
  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.paymentMethodsService.restore(id);
  }
}
