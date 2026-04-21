# Database Package

Prisma schema and client for Naro Fashion multi-tenant SaaS.

## Files
- `prisma/schema.prisma` - Database schema (50+ models, all tenant-scoped)
- `prisma/seed.ts` - Original seed (categories, products, shipping) — pre-multi-tenant
- `prisma/migrate-to-multi-tenant.js` - Creates first Tenant, PlatformAdmin, subscription plans, backfills tenantId
- `prisma/seed-tenant.js` - Seeds site settings, CMS pages, branding, payment methods, expense categories
- `prisma/seed-mock-data.js` - Seeds demo customers, orders, rentals, reviews, expenses, events, etc.
- `.env` - Database connection string

## Multi-Tenant Models (platform-level, no tenantId)
Tenant, PlatformAdmin, TenantBranding, SubscriptionPlan, TenantSubscription, TenantPayment, TenantModule

## Tenant-Scoped Models (have tenantId field)
User, AdminUser, AdminActivityLog, LoginAttempt, CustomerIDDocument, Category, Product, ProductVariant, Order, Payment, Shipment, Invoice, ShippingZone, Review, RentalOrder, RentalChecklistTemplate, RentalPolicy, FlashSale, ReferralCode, Banner, HeroSlide, Page, SizeGuide, SiteSetting, InstagramPost, NewsletterSubscriber, Newsletter, PickupPoint, InventoryTransaction, ExpenseCategory, BusinessExpense, FinancialPeriod, Role, PosSession, HeldSale, Layaway, PosExchange, PromoCode, CustomerEvent, AbandonedCartReminder, PaymentMethod, ContactSubmission

## Child Models (no tenantId, inherit scope via parent FK)
Address, CartItem, WishlistItem, OrderItem, ProductImage, ProductVideo, ShippingRate, ReviewImage, FlashSaleItem, RentalChecklistTemplateItem, RentalChecklistEntry, RentalPreparationReminder, Referral, EventMedia, NewsletterDelivery, NewsletterProduct, PromoCodeUsage, RolePermission, AdminUserRole

## Unique Constraints (per-tenant)
Many fields changed from `@unique` to `@@unique([tenantId, field])`: Category.slug, Product.slug, Product.sku, ProductVariant.sku, ProductVariant.barcode, Order.orderNumber, RentalOrder.rentalNumber, Page.slug, SiteSetting.key, Role.name, etc.
**Keep globally unique**: AdminUser.email, Permission.code, Payment.transactionRef

## Instagram & Newsletter Models (added 2026-03)
- **InstagramPost** - Posts synced from Instagram Graph API or manually added. Fields: source (INSTAGRAM_API/MANUAL), isPinned, instagramMediaId (unique for dedup), mediaType, postedAt
- **NewsletterSubscriber** - Email subscribers with unsubscribeToken, source (STOREFRONT/ADMIN/IMPORT)
- **Newsletter** - Email campaigns with templateType (NEW_ARRIVALS/NEW_DEALS/TIPS/CUSTOM), status (DRAFT/SENDING/SENT/FAILED)
- **NewsletterDelivery** - Per-recipient delivery tracking (PENDING/SENT/FAILED) with failureReason
- **NewsletterProduct** - Join table tracking which products were included in newsletters (prevents duplicates in NEW_ARRIVALS)

## New Models (added 2026-03)
- **InventoryTransaction** - Stock movement log (RESTOCK/SALE/RENTAL_OUT/RENTAL_RETURN/ADJUSTMENT/DAMAGE)
- **ExpenseCategory** - DB-stored expense categories (name @unique, isActive, soft-delete)
- **BusinessExpense** - Business expenses linked to ExpenseCategory, period = "YYYY-MM"
- **FinancialPeriod** - Monthly financial periods (OPEN/CLOSED/LOCKED)
- **Permission** - Granular permissions (code @unique, module:action pattern)
- **Role** - RBAC roles (name @unique, isSystem for seeded roles)
- **RolePermission** - Join table (Role ↔ Permission)
- **AdminUserRole** - Join table (AdminUser ↔ Role)
- **LoginAttempt** - Login audit log

## AdminUser additions (2026-03)
- `failedLoginAttempts`, `lockedUntil` - Account lockout support
- `passwordResetToken`, `passwordResetExpires` - Self-service password reset (SHA-256 hashed token)
- `avatarUrl`, `createdBy`, `deletedAt` - Profile and soft-delete support
- `roles AdminUserRole[]` - RBAC relation

## Product additions (2026-03)
- `purchasePrice`, `minimumStock`, `supplierName`, `supplierContact`, `lastRestockedAt` - Inventory management fields
- `inventoryTransactions InventoryTransaction[]` - Transaction log relation

## Commands
- `pnpm prisma generate` - Generate Prisma client
- `pnpm prisma db push` - Push schema to DB (also generates client)
- `pnpm prisma migrate dev` - Create and run migrations
- `pnpm prisma studio` - Open Prisma Studio GUI
- `pnpm prisma db seed` - Run seed script

## Payment gateway additions (planned — ClickPesa integration)
Plan file: `C:\Users\rjurio\.claude\plans\groovy-painting-pudding.md`.
- `Payment.providerCode String?` — identifies which gateway handled the payment (e.g. `SELCOM`, `CLICKPESA_MIXX`). Indexed alongside `status` for the reconciliation cron scan.
- `Payment.providerTransactionId String?` — the gateway's own payment id (ClickPesa's `id`, Selcom's `transid`). First-class column so we can query without unwrapping `gatewayResponse` JSON.
- `Payment.lastPolledAt DateTime?` — throttles the reconciliation cron: re-poll only if null or older than `CLICKPESA_POLL_INTERVAL_SECONDS`.
- New `WebhookEvent` model for idempotent webhook replay — fields: `id`, `tenantId`, `providerCode`, `providerEventId`, `eventType`, `orderReference?`, `checksumValid?`, `rawPayload Json`, `processed Boolean`, `receivedAt`. `@@unique([providerCode, providerEventId, eventType])` catches duplicate deliveries; index `[tenantId, orderReference]` for lookups.
- `PaymentMethod.integrationParams` JSON for code `CLICKPESA_MIXX` holds `{ clientId, apiKey, checksumSecret, usePreview, webhookIpAllowlist[] }` per tenant — ClickPesa credentials live here, not in `.env`.

## RentalOrder additions (2026-03)
- `pickupTime`, `weddingDate`, `weddingLocation`, `weddingRegion` - Event details
- `deliveryModality` (HAND_PICKED/SHIPPED), `shippingDate`, `shippingAddress` - Delivery logistics
- `transportMode` (AIR/BUS/TRAIN/COURIER/OTHER), `transportReceiptUrl` - Transport tracking

## Conventions
- All schema changes go in `schema.prisma`
- Export Prisma client for use by other packages/apps
- PostgreSQL 17, database: `naro_fashion`, user: `naro_admin`
- Use local Prisma v6.19.2 (global v7 has breaking changes) — always run from this directory
- P2002 = unique constraint violation → catch in service layer and throw NestJS ConflictException
