import { Module } from '@nestjs/common';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';
import { RentalMoneyController } from './rental-money.controller';
import { RentalMoneyService } from './rental-money.service';
import { RentalUnitsController } from './rental-units.controller';
import { RentalUnitsService } from './rental-units.service';
import { PosRentalsController } from './pos-rentals.controller';
import { PosRentalsService } from './pos-rentals.service';
import { IdVerificationModule } from '../id-verification/id-verification.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [IdVerificationModule, PaymentsModule],
  controllers: [RentalsController, RentalMoneyController, RentalUnitsController, PosRentalsController],
  providers: [RentalsService, RentalMoneyService, RentalUnitsService, PosRentalsService],
  exports: [RentalsService, RentalMoneyService, RentalUnitsService],
})
export class RentalsModule {}
