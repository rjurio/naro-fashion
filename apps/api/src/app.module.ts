import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ShippingModule } from './shipping/shipping.module';
import { ReviewsModule } from './reviews/reviews.module';
import { RentalsModule } from './rentals/rentals.module';
import { RentalChecklistsModule } from './rental-checklists/rental-checklists.module';
import { RentalPoliciesModule } from './rental-policies/rental-policies.module';
import { IdVerificationModule } from './id-verification/id-verification.module';
import { FlashSalesModule } from './flash-sales/flash-sales.module';
import { ReferralsModule } from './referrals/referrals.module';
import { CmsModule } from './cms/cms.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UploadModule } from './upload/upload.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PrismaModule } from './prisma/prisma.module';
import { PermissionsModule } from './permissions/permissions.module';
import { RolesModule } from './roles/roles.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module';
import { ExpensesModule } from './expenses/expenses.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReportsModule } from './reports/reports.module';
import { EventsModule } from './events/events.module';
import { PosModule } from './pos/pos.module';
import { PromoCodesModule } from './promo-codes/promo-codes.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { SizeGuidesModule } from './size-guides/size-guides.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuditModule } from './audit/audit.module';
import { ProductSizesModule } from './product-sizes/product-sizes.module';
import { AiModule } from './ai/ai.module';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';
import { HealthModule } from './health/health.module';
import { AppThrottlerGuard } from './health/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Default bucket: 100 req/min per client IP (req.ip — real client IP via
    // trust proxy in main.ts). Enforced globally by AppThrottlerGuard below;
    // tighter per-route limits via @Throttle, opt-outs via @SkipThrottle.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    // ONLY the public uploads dir is served. Private evidence (ID documents)
    // lives in PRIVATE_UPLOAD_DIR (default <cwd>/private-uploads), outside
    // this root, and is streamed solely via the admin-only
    // GET /upload/id-document/:key endpoint.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
    }),
    PrismaModule,
    TenantModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CategoriesModule,
    CartModule,
    WishlistModule,
    OrdersModule,
    PaymentsModule,
    ShippingModule,
    ReviewsModule,
    RentalsModule,
    RentalChecklistsModule,
    RentalPoliciesModule,
    IdVerificationModule,
    FlashSalesModule,
    ReferralsModule,
    CmsModule,
    AnalyticsModule,
    NotificationsModule,
    UploadModule,
    SchedulerModule,
    PermissionsModule,
    RolesModule,
    AdminUsersModule,
    ExpenseCategoriesModule,
    ExpensesModule,
    ProductSizesModule,
    InventoryModule,
    ReportsModule,
    EventsModule,
    PosModule,
    PromoCodesModule,
    NewsletterModule,
    SizeGuidesModule,
    PaymentMethodsModule,
    TenantsModule,
    AiModule,
    AiAssistantModule,
    HealthModule,
  ],
  providers: [
    // Global rate limiting. Was configured via ThrottlerModule.forRoot but
    // never enforced because no ThrottlerGuard was registered.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
