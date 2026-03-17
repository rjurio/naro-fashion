import { Module } from '@nestjs/common';
import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { InstagramService } from './instagram.service';

@Module({
  controllers: [CmsController],
  providers: [CmsService, InstagramService],
  exports: [CmsService, InstagramService],
})
export class CmsModule {}
