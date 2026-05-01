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
import { VisitorAnalyticsService } from './visitor-analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequiresModule } from '../auth/decorators/requires-module.decorator';
import { Public } from '../auth/decorators/public.decorator';

class TrackPageViewDto {
  @IsString() @MaxLength(100) sessionId: string;
  @IsString() @MaxLength(500) path: string;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @IsOptional() @IsString() @MaxLength(100) userId?: string;
}

function extractIp(req: Request): string | undefined {
  // Trust nginx X-Forwarded-For (first hop = client IP)
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
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
  @Post('track')
  @HttpCode(HttpStatus.NO_CONTENT)
  async track(@Body() dto: TrackPageViewDto, @Req() req: Request) {
    const tenantId =
      (req.headers['x-tenant-id'] as string | undefined) || (req as any).tenantId;
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

  // ---- Admin stats endpoints (require analytics module) ----

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/overview')
  overview(@Query() query: any) {
    return this.service.overview(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/timeseries')
  timeseries(@Query() query: any) {
    return this.service.timeseries(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/top-pages')
  topPages(@Query() query: any) {
    return this.service.topPages(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/countries')
  countries(@Query() query: any) {
    return this.service.countries(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/devices')
  devices(@Query() query: any) {
    return this.service.devices(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/referrers')
  referrers(@Query() query: any) {
    return this.service.referrers(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @RequiresModule('analytics')
  @Get('visitors/hourly')
  hourly(@Query() query: any) {
    return this.service.hourly(query);
  }
}
