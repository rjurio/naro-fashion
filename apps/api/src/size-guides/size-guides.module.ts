import { Module } from '@nestjs/common';
import { SizeGuidesService } from './size-guides.service';
import { SizeGuidesController } from './size-guides.controller';

@Module({
  controllers: [SizeGuidesController],
  providers: [SizeGuidesService],
  exports: [SizeGuidesService],
})
export class SizeGuidesModule {}
