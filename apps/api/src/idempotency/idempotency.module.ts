import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyRetentionService } from './idempotency-retention.service';

/**
 * Admin offline mode: global `Idempotency-Key` support for admin mutations
 * + nightly retention. PrismaModule is global.
 */
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    IdempotencyRetentionService,
  ],
})
export class IdempotencyModule {}
