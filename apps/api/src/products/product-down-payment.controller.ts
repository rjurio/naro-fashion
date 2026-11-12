import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { ProductDownPaymentService } from './product-down-payment.service';
import { SetRentalDownPaymentDto } from './dto/set-rental-down-payment.dto';

/**
 * Admin: a product's rental down-payment setting (Inherit shop policy /
 * Custom %). Kept apart from PATCH /products/:id on purpose: an ordinary
 * product save cannot change it, and changing it needs its own permission.
 */
@Controller('products')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ProductDownPaymentController {
  constructor(private readonly service: ProductDownPaymentService) {}

  /** What a new product would get (it inherits the shop default). */
  @Get('rental-down-payment/defaults')
  defaults() {
    return this.service.defaults();
  }

  @Get(':id/rental-down-payment')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @UseGuards(PermissionGuard)
  @RequiresPermission('rental-policies:manage')
  @Patch(':id/rental-down-payment')
  set(@Param('id') id: string, @Body() dto: SetRentalDownPaymentDto) {
    return this.service.set(id, dto);
  }
}
