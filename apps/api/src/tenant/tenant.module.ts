import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContext } from './tenant.context';
import { TenantInterceptor } from './tenant.interceptor';
import { TenantGuard } from '../auth/guards/tenant.guard';

/**
 * TenantModule provides TenantContext as a global, request-scoped injectable
 * and registers the global TenantInterceptor + global TenantGuard. JwtModule +
 * ConfigModule are imported here so all three can verify Bearer tokens for
 * tenant resolution / cross-checks.
 *
 * TenantGuard (global) blocks SUSPENDED / DEACTIVATED tenants from every
 * tenant-scoped API call — see auth/guards/tenant.guard.ts.
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
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
  ],
  exports: [TenantContext],
})
export class TenantModule {}
