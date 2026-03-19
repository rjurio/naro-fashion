import { SetMetadata } from '@nestjs/common';

export const REQUIRES_MODULE_KEY = 'requiredModule';

/**
 * Marks a controller or handler as requiring a specific module to be enabled for the tenant.
 * Used with ModuleGuard to check TenantModule table.
 *
 * Usage:
 * @RequiresModule('rentals')
 * @Controller('rentals')
 * export class RentalsController { ... }
 */
export const RequiresModule = (moduleCode: string) =>
  SetMetadata(REQUIRES_MODULE_KEY, moduleCode);
