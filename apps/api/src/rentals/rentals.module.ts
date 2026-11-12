import { Module } from '@nestjs/common';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';
import { RentalMoneyController } from './rental-money.controller';
import { RentalMoneyService } from './rental-money.service';
import { RentalUnitsController } from './rental-units.controller';
import { RentalUnitsService } from './rental-units.service';

@Module({
  controllers: [RentalsController, RentalMoneyController, RentalUnitsController],
  providers: [RentalsService, RentalMoneyService, RentalUnitsService],
  exports: [RentalsService, RentalMoneyService, RentalUnitsService],
})
export class RentalsModule {}
