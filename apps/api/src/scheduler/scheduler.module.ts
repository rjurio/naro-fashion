import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CmsModule } from '../cms/cms.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [PrismaModule, CmsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
