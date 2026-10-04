import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GET /api/v1/health — liveness + DB readiness probe for uptime monitors and
 * post-deploy smoke tests. Public, not throttled, not tenant-scoped.
 *
 * `commit` echoes env GIT_SHA (set by deploy.sh) so a deploy can be verified
 * against the pushed SHA by hitting live code, not just `git rev-parse`.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let db: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    if (db === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      uptime: Math.round(process.uptime()),
      commit: process.env.GIT_SHA ?? null,
    };
  }
}
