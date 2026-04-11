import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { TenantContext } from './tenant.context';

/**
 * TenantModule provides TenantContext as a global, request-scoped injectable.
 * Import once in AppModule — available everywhere.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), ConfigModule],
  providers: [TenantContext],
  exports: [TenantContext],
})
export class TenantModule {}
