import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * AuditModule provides AuditService as a global, request-scoped injectable.
 * Import once in AppModule — available everywhere without importing.
 * Also exposes AuditController for querying and exporting audit logs.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
