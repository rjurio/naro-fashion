import { Module, Global } from '@nestjs/common';
import { TenantContext } from './tenant.context';

/**
 * TenantModule provides TenantContext as a global, request-scoped injectable.
 * Import once in AppModule — available everywhere.
 */
@Global()
@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantModule {}
