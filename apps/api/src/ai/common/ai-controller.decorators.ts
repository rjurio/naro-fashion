import { applyDecorators, UseFilters, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { AiPermissionGuard } from '../guards/ai-permission.guard';
import { AiExceptionFilter } from '../filters/ai-exception.filter';

/**
 * AiSecured() bundles the four decorators every AI controller class must
 * carry: JwtAuthGuard → AdminGuard → AiPermissionGuard, plus the AI
 * exception filter that re-shapes thrown errors into the envelope.
 *
 * Usage:
 *   @AiSecured()
 *   @Controller('ai/products')
 *   export class ProductsAiController {}
 */
export function AiSecured() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, AdminGuard, AiPermissionGuard),
    UseFilters(AiExceptionFilter),
  );
}
