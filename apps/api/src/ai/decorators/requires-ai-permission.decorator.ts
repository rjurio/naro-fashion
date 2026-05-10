import { SetMetadata } from '@nestjs/common';
import {
  AiScopePermissionCode,
  AI_PERMISSION_CODES,
} from '../types/ai-permissions.types';

/**
 * Reflector key used by AiPermissionGuard to discover the per-route scope
 * permission requirement.
 */
export const REQUIRES_AI_PERMISSION_KEY = 'requiresAiPermission';

/**
 * Mark a route (or controller class) as requiring a specific AI scope
 * permission in addition to `ai-agent:use`. Phase 3.0 ships the decorator
 * + guard logic; Phase 3.1 will start applying the decorator to the new
 * risky-action routes.
 *
 * Usage:
 *   @RequiresAiPermission(AI_PERMISSION_CODES.READ)
 *   @Get('search')
 *   search() {...}
 *
 *   @RequiresAiPermission(AI_PERMISSION_CODES.APPROVE)
 *   @Post('approvals/:id/approve')
 *   approve() {...}
 *
 * `ai-agent:use` is always required separately by AiPermissionGuard — this
 * decorator only declares the scope-tier permission on top.
 */
export const RequiresAiPermission = (perm: AiScopePermissionCode) =>
  SetMetadata(REQUIRES_AI_PERMISSION_KEY, perm);

// Re-export the codes so callers can write
//   @RequiresAiPermission(AI_PERMISSION_CODES.READ)
// without a second import.
export { AI_PERMISSION_CODES };
