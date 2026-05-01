import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { VisitorAnalyticsController } from './visitor-analytics.controller';
import { VisitorAnalyticsService } from './visitor-analytics.service';

@Module({
  controllers: [AnalyticsController, VisitorAnalyticsController],
  providers: [AnalyticsService, VisitorAnalyticsService],
  exports: [AnalyticsService, VisitorAnalyticsService],
})
export class AnalyticsModule {}
