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
User, AdminUser, AdminActivityLog, LoginAttempt, CustomerIDDocument, Category, Product, ProductVariant, Order, Payment, Shipment, Invoice, ShippingZone, Review, RentalOrder, RentalChecklistTemplate, RentalPolicy, FlashSale, ReferralCode, Banner, HeroSlide, ParallaxSection, Page, SizeGuide, SiteSetting, InstagramPost, NewsletterSubscriber, Newsletter, PickupPoint, InventoryTransaction, ExpenseCategory, BusinessExpense, FinancialPeriod, Role, PosSession, HeldSale, Layaway, PosExchange, PromoCode, CustomerEvent, AbandonedCartReminder, PaymentMethod, ContactSubmission

## ParallaxSection (added 2026-04-13)
- Per-tenant homepage parallax backgrounds. Composite unique `(tenantId, sectionKey)` so each tenant has at most one row per section.
- `sectionKey` (string enum, validated by API): HERO_AMBIENT, CATEGORIES, NEW_ARRIVALS, RENTAL, WEDDINGS, INSTAGRAM, FOOTER_BAND.
- `effectType` (string enum, default `TRANSLATE_VERTICAL`): TRANSLATE_VERTICAL, TRANSLATE_HORIZONTAL, FIXED, ZOOM_ON_SCROLL, MIRROR, MOUSE_TILT, STATIC.
- `scrollSpeed` Float (default 0.35) — used by TRANSLATE_*/MIRROR effects.
- `overlayOpacity` Float (default 0.45) + `overlayColor` String (default `#000000`) for darkening over the backdrop.
- `blurPx` Int (default 0) for mood-wash mode.
- Soft-deletes via `deletedAt`. Indexes: `tenantId`, `(isActive, sectionKey)`, `deletedAt`.

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

## PostgreSQL ownership (production gotcha)
Prisma's `db push` runs `ALTER TABLE` statements, which require **table ownership** — not just `GRANT ALL PRIVILEGES`. If a table is owned by `postgres` (the install superuser) but the runtime user is `naro_admin`, `db push` fails with `ERROR: must be owner of table <Name>` mid-deploy. The deploy script then aborts under `set -e` before `pm2 restart`, leaving prod on stale code.

**One-time fix on any new DB or after restoring a backup as a different user:**

```sql
-- Grant access (read/write) — needed for the runtime user even when not owner
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO naro_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO naro_admin;

-- Reassign ownership — required for Prisma db push / ALTER TABLE
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO naro_admin', r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO naro_admin', r.sequence_name);
  END LOOP;
END $$;
```

Run as `postgres` superuser (`sudo -u postgres psql -d naro_fashion -c "..."`). Tables/sequences created later by Prisma `db push` are auto-owned by `naro_admin` since it's the connection user, so this only needs to run once per DB.

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
