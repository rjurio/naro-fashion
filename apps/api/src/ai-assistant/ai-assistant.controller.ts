import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { TenantContext } from '../tenant/tenant.context';
import { AiAssistantService } from './ai-assistant.service';
import { ChatRequestDto, validateChatTotalSize } from './ai-assistant.dto';
import { AiDailyBudget } from './ai-assistant-budget';

// Module-level singleton: AiAssistantController is a request-scoped consumer
// (it injects TenantContext), so an instance field would reset per request.
const dailyBudget = new AiDailyBudget();

/**
 * In-admin AI chat. Every chat request costs real Anthropic tokens (up to
 * MAX_ITERATIONS model calls), so it is gated four ways:
 *   1. JwtAuthGuard + AdminGuard — tenant admins only
 *   2. PermissionGuard + `ai-agent:use` — same permission as the /ai/* tools
 *      (previously any admin, incl. STAFF without the permission, could
 *      burn the platform's API key here even though every tool call would
 *      then 403)
 *   3. @Throttle 10 chat requests/min per client IP
 *   4. Per-tenant daily request budget (AI_ASSISTANT_DAILY_REQUEST_LIMIT)
 */
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
@RequiresPermission('ai-agent:use')
@Controller('ai-assistant')
export class AiAssistantController {
  constructor(
    private readonly service: AiAssistantService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get('status')
  status() {
    return {
      configured: this.service.isConfigured(),
      message: this.service.isConfigured()
        ? 'AI assistant is ready'
        : 'ANTHROPIC_API_KEY is not set on the server. Ask the platform admin to configure it.',
    };
  }

  @Post('chat')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(
    @Body() dto: ChatRequestDto,
    @Headers('authorization') auth: string,
  ) {
    const sizeError = validateChatTotalSize(dto.messages);
    if (sizeError) throw new BadRequestException(sizeError);

    const bearerToken = (auth || '').replace(/^Bearer\s+/i, '');
    const tenantId = this.tenantContext.requireId;

    if (!this.service.isConfigured()) {
      // Let the service raise its 503 without consuming budget.
      return this.service.chat(dto.messages, bearerToken, tenantId);
    }

    const budget = dailyBudget.consume(tenantId);
    if (!budget.allowed) {
      throw new HttpException(
        `Daily AI assistant limit reached for this store (${budget.limit} requests/day). It resets at 00:00 UTC.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.service.chat(dto.messages, bearerToken, tenantId);
  }
}
