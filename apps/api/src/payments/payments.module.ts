import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SelcomProvider } from './selcom.provider';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, SelcomProvider],
  exports: [PaymentsService, SelcomProvider],
})
export class PaymentsModule {}
