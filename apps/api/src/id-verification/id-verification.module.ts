import { Module } from '@nestjs/common';
import { IdVerificationController } from './id-verification.controller';
import { IdVerificationService } from './id-verification.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [IdVerificationController],
  providers: [IdVerificationService],
  exports: [IdVerificationService],
})
export class IdVerificationModule {}
