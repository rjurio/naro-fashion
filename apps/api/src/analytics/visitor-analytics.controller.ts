import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { VisitorAnalyticsService } from './visitor-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { Public } from '../auth/decorators/public.decorator';

class TrackPageViewDto {
  @IsString() @MaxLength(100) sessionId: string;
  @IsString() @MaxLength(500) path: string;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @IsOptional() @IsString() @MaxLength(100) userId?: string;
}

/**
 * Client IP for geo lookup. eq.ip is the real client address because
 * main.ts sets 	rust proxy = 1 (nginx is the single trusted hop). We no
 * longer read the LEFTMOST X-Forwarded-For entry — that value is supplied
 * by the client and trivially spoofable.
 */
export function extractIp(req: Request): string | undefined {
  return req.ip || req.socket?.remoteAddress;
}

@Controller('analytics')
export class VisitorAnalyticsController {
  constructor(private readonly service: VisitorAnalyticsService) {}

  // ---- Public tracking endpoint ----
  // Called from the storefront on every route change. Tenant comes from
  // X-Tenant-Id (storefront middleware sets the cookie which the API client
  // forwards). No auth required — anonymous traffic is the whole point.
  @Public()
  // Tighter than the 100/min global default: one call per storefront route
  // change is far below this, but it caps junk-row floods into PageView.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('track')
  @HttpCode(HttpStatus.NO_CONTENT)
  async track(@Body() dto: TrackPageViewDto, @Req() req: Request) {
    // Prefer the interceptor-resolved tenant (cross-checked against any JWT)
    // over the raw header.
    const tenantId =
      (req as any).tenantId || (req.headers['x-tenant-id'] as string | undefined);
    if (!tenantId) return;

    await this.service.track({
      tenantId,
      sessionId: dto.sessionId,
      userId: dto.userId,
      path: dto.path,
      referrer: dto.referrer,
      userAgent: req.headers['user-agent'] as string | undefined,
      ip: extractIp(req),
    });
  }

  // ---- Admin stats endpoints (require analytics module + admin role) ----

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/overview')
  overview(@Query() query: any) {
    return this.service.overview(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/timeseries')
  timeseries(@Query() query: any) {
    return this.service.timeseries(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/top-pages')
  topPages(@Query() query: any) {
    return this.service.topPages(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/countries')
  countries(@Query() query: any) {
    return this.service.countries(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/devices')
  devices(@Query() query: any) {
    return this.service.devices(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/referrers')
  referrers(@Query() query: any) {
    return this.service.referrers(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/hourly')
  hourly(@Query() query: any) {
    return this.service.hourly(query);
  }
}
