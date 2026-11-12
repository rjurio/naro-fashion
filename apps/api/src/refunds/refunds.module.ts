import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PosModule } from '../pos/pos.module';
import { RentalsModule } from '../rentals/rentals.module';
import { RefundRequestsController } from './refund-requests.controller';
import { RefundRequestsService } from './refund-requests.service';

/** Unified refund workflow (R1b). Orchestrates; each domain still owns its payout logic. */
@Module({
  imports: [OrdersModule, PosModule, RentalsModule],
  controllers: [RefundRequestsController],
  providers: [RefundRequestsService],
})
export class RefundsModule {}
