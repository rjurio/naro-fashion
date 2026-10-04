import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderExpiryCron } from './order-expiry.cron';
import { OrderRefundsController } from './order-refunds.controller';
import { OrderRefundsService } from './order-refunds.service';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PromoCodesModule, PaymentsModule],
  controllers: [OrdersController, OrderRefundsController],
  providers: [OrdersService, OrderExpiryCron, OrderRefundsService],
  exports: [OrdersService],
})
export class OrdersModule {}
