import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsString, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { TenantContext } from '../tenant/tenant.context';
import { AiAssistantService } from './ai-assistant.service';

class ChatMessageDto {
  @IsString() @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() content: string;
}

class ChatRequestDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}

@UseGuards(JwtAuthGuard, AdminGuard)
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
  async chat(
    @Body() dto: ChatRequestDto,
    @Req() req: Request,
    @Headers('authorization') auth: string,
  ) {
    const bearerToken = (auth || '').replace(/^Bearer\s+/i, '');
    const tenantId = this.tenantContext.requireId;
    return this.service.chat(dto.messages, bearerToken, tenantId);
  }
}
