import { Module } from '@nestjs/common';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';
import { RentalMoneyController } from './rental-money.controller';
import { RentalMoneyService } from './rental-money.service';

@Module({
  controllers: [RentalsController, RentalMoneyController],
  providers: [RentalsService, RentalMoneyService],
  exports: [RentalsService, RentalMoneyService],
})
export class RentalsModule {}
