import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SyncService } from './sync.service';
import { SyncChangesQueryDto } from './sync-changes.dto';

/**
 * Admin offline mode — change feed counts for the "Newer data online"
 * badge. Any admin may read counts (no extra permission); tenant-scoped.
 */
@Controller('sync')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('changes')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  changes(@Query() query: SyncChangesQueryDto) {
    return this.syncService.changes(query.since);
  }
}
