import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductDownPaymentController } from './product-down-payment.controller';
import { ProductDownPaymentService } from './product-down-payment.service';

@Module({
  controllers: [ProductDownPaymentController, ProductsController],
  providers: [ProductsService, ProductDownPaymentService],
  exports: [ProductsService],
})
export class ProductsModule {}
