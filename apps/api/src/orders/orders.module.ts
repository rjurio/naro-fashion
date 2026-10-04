import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderExpiryCron } from './order-expiry.cron';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';

@Module({
  imports: [PromoCodesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderExpiryCron],
  exports: [OrdersService],
})
export class OrdersModule {}