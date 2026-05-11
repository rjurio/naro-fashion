import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { CategoriesModule } from '../categories/categories.module';
import { ProductSizesModule } from '../product-sizes/product-sizes.module';
import { OrdersModule } from '../orders/orders.module';
import { RentalsModule } from '../rentals/rentals.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RentalPoliciesModule } from '../rental-policies/rental-policies.module';
import { SizeGuidesModule } from '../size-guides/size-guides.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ReportsModule } from '../reports/reports.module';

import { AiSanitizerService } from './services/ai-sanitizer.service';
import { AiAuditService } from './services/ai-audit.service';
import { AiToolRunner } from './services/ai-tool-runner.service';
import { AiRolesSeederService } from './services/ai-roles-seeder.service';
import { ApprovalService } from './services/approval.service';
import { PublishValidationService } from './services/publish-validation.service';
import { ApprovalExpiryCron } from './services/approval-expiry.cron';
import { AiPermissionGuard } from './guards/ai-permission.guard';
import { AiExceptionFilter } from './filters/ai-exception.filter';

import { ProductsAiController } from './controllers/products.ai.controller';
import { CategoriesAiController } from './controllers/categories.ai.controller';
import { ProductSizesAiController } from './controllers/product-sizes.ai.controller';
import { OrdersAiController } from './controllers/orders.ai.controller';
import { RentalsAiController } from './controllers/rentals.ai.controller';
import { InventoryAiController } from './controllers/inventory.ai.controller';
import { RentalPoliciesAiController } from './controllers/rental-policies.ai.controller';
import { SizeGuideAiController } from './controllers/size-guide.ai.controller';
import { RecycleBinAiController } from './controllers/recycle-bin.ai.controller';
import { ReportsAiController } from './controllers/reports.ai.controller';
import { ApprovalsAiController } from './controllers/approvals.ai.controller';

/**
 * AiModule — Phase 1 (read-only).
 *
 * Imports every existing module whose service the AI controllers wrap.
 * No new business logic lives here; the AI surface is a thin, audited
 * read-only layer over what the admin UI already uses.
 *
 * Phase 2 will introduce draft-creation tools.
 * Phase 3 will introduce approval-gated writes (AgentApprovalRequest).
 */
@Module({
  imports: [
    PrismaModule,
    ProductsModule,
    CategoriesModule,
    ProductSizesModule,
    OrdersModule,
    RentalsModule,
    InventoryModule,
    RentalPoliciesModule,
    SizeGuidesModule,
    AnalyticsModule,
    ReportsModule,
  ],
  controllers: [
    ProductsAiController,
    CategoriesAiController,
    ProductSizesAiController,
    OrdersAiController,
    RentalsAiController,
    InventoryAiController,
    RentalPoliciesAiController,
    SizeGuideAiController,
    RecycleBinAiController,
    ReportsAiController,
    ApprovalsAiController,
  ],
  providers: [
    AiSanitizerService,
    AiAuditService,
    AiToolRunner,
    AiPermissionGuard,
    AiExceptionFilter,
    AiRolesSeederService,
    ApprovalService,
    PublishValidationService,
    ApprovalExpiryCron,
  ],
})
export class AiModule {}
