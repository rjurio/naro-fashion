import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContext } from './tenant.context';
import { TenantInterceptor } from './tenant.interceptor';

/**
 * TenantModule provides TenantContext as a global, request-scoped injectable
 * and registers the global TenantInterceptor. JwtModule + ConfigModule are
 * imported here so both can verify Bearer tokens for tenant cross-checks.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), ConfigModule],
  providers: [
    TenantContext,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
  exports: [TenantContext],
})
export class TenantModule {}
