import { Module } from '@nestjs/common';
import { IdVerificationController } from './id-verification.controller';
import { IdVerificationService } from './id-verification.service';

@Module({
  controllers: [IdVerificationController],
  providers: [IdVerificationService],
  exports: [IdVerificationService],
})
export class IdVerificationModule {}
