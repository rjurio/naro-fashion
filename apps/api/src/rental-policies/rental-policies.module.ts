import { Module } from '@nestjs/common';
import { RentalPoliciesController } from './rental-policies.controller';
import { RentalPoliciesService } from './rental-policies.service';

@Module({
  controllers: [RentalPoliciesController],
  providers: [RentalPoliciesService],
  exports: [RentalPoliciesService],
})
export class RentalPoliciesModule {}
