import { Module } from '@nestjs/common';
import { RentalChecklistsController } from './rental-checklists.controller';
import { RentalChecklistsService } from './rental-checklists.service';

@Module({
  controllers: [RentalChecklistsController],
  providers: [RentalChecklistsService],
  exports: [RentalChecklistsService],
})
export class RentalChecklistsModule {}
