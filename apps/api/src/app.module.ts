import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
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
  ],
})
export class AppModule {}
