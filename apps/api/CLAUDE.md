# API (NestJS)

REST API backend for Naro Fashion. Runs on port 4000, prefix `/api/v1`.

## Stack
- NestJS 11, TypeScript, Prisma ORM, PostgreSQL 17
- Passport.js + JWT for authentication
- class-validator + class-transformer for DTOs
- Local file storage for image uploads (ServeStaticModule serves `/uploads`), Multer for multipart
- @nestjs/serve-static for serving uploaded files

## Multi-Tenancy
- **TenantContext** (`src/tenant/tenant.context.ts`): Request-scoped injectable providing `tenantId`. Use `this.tenantContext.requireId` in all Prisma queries. Falls back to decoding JWT from `Authorization` header when `req.user` is not set (for `@Public()` endpoints). `requireId` throws `BadRequestException` (400) with actionable message ("Provide X-Tenant-Id header or a valid Authorization token") instead of generic 500 — cleaner public API responses.
- **TenantInterceptor** (`src/tenant/tenant.interceptor.ts`): Global interceptor, extracts tenantId from JWT or `X-Tenant-Id` header.
- **TenantGuard** (`src/auth/guards/tenant.guard.ts`): Validates tenant is ACTIVE.
- **ModuleGuard** (`src/auth/guards/module.guard.ts`): Checks `@RequiresModule()` decorator against TenantModule table. 5-min cache per tenant. Decodes JWT payload from `Authorization` header for `@Public()` endpoints (uses Base64 decode, no external dependency).
- **PlatformAdminGuard** (`src/auth/guards/platform-admin.guard.ts`): Restricts to platform admins.
- **@RequiresModule()** (`src/auth/decorators/requires-module.decorator.ts`): Decorator for optional module controllers.
- **TenantsModule** (`src/tenants/`): Full CRUD for tenants, subscriptions, billing, modules. Public resolve endpoint for storefront.
- All 26 services inject TenantContext and scope queries with `tenantId`.
- **IMPORTANT**: `@Public()` endpoints skip `JwtAuthGuard`, so `req.user` is never populated. Both `TenantContext` and `ModuleGuard` handle this by decoding the JWT from the Authorization header directly.
- Do NOT import from `@naro/shared` in API services (ESM/CJS mismatch). Define constants locally.

## Authentication
- Three-tier auth: `PlatformAdmin` (platform) → `AdminUser` (tenant staff) → `User` (customers)
- `validateUser()` checks User (with tenantId from header) then AdminUser (globally unique email)
- `validatePlatformAdmin()` checks PlatformAdmin table separately
- `generateTokens()` includes `tenantId`, `isAdmin`, `isPlatformAdmin`, `role` in JWT payload
- `JwtStrategy.validate()` checks: isPlatformAdmin → AdminUser (isAdmin) → User → AdminUser fallback
- Endpoints: `POST /auth/login`, `POST /auth/platform-login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`
- Profile: `GET /auth/me` returns `enabledModules[]` for tenant admins
- Password reset: `POST /auth/forgot-password`, `POST /auth/reset-password`
- Account lockout: 5 failed attempts → lockedUntil = +30min; logged to LoginAttempt table

## Modules (all fully implemented)
- **auth** - Login, register, JWT access/refresh tokens, profile, password change, 2FA toggle, forgot/reset password, account lockout
- **users** - Customer-facing: profile CRUD, addresses CRUD. Admin: `GET /users?search=` (list all tenant customers with order/rental counts, total spent), `PATCH /users/:id/suspend`, `PATCH /users/:id/activate`
- **products** - Full CRUD with variants, images, search, filtering, toggle active, soft delete/restore, admin listing (includes inactive), purchasePrice/minimumStock/supplier fields, `GET /products/by-id/:id` for edit page. `POST /products/bulk-import` accepts a multipart CSV file (max 5MB, 500 rows) for batch product creation — resolves category by slug or name, returns `{ created, failed, total, errors[] }` with per-row validation feedback.
- **categories** - Nested category tree CRUD, soft delete/restore. `findAll()` returns 3 levels deep and includes `_count: { products: { where: { deletedAt: null } } }` at **every** nesting level (parent + children + grandchildren) — child categories would otherwise report 0 products in the admin tree. Soft-deleted products are excluded from the count. After the Prisma query, `findAll()` runs a second `product.findMany()` to collect the newest product-with-image per category (keyed by `categoryId`), then recursively attaches two computed fields to each node: `fallbackImageUrl` (first product image from the category or any descendant) and `totalProductCount` (direct + descendant rolled up). This lets storefront tiles show a real gown photo + rolled-up count for parents like "Wedding Dresses" whose inventory lives in subcategories.
- **cart** - Add/update/remove items, merge guest cart, count
- **wishlist** - Toggle, check, count
- **orders** - Create from cart, status workflow, admin listing, stats
- **payments** - Create, update status, webhooks, payment summary
- **shipping** - Zones CRUD, rate calculation, shipment tracking
- **reviews** - Create, approve/reject, rating stats, product aggregation
- **rentals** - Booking, availability check, status workflow, upcoming pickups, pending returns, overdue tracking, admin update (wedding/shipping/transport details), transport receipt upload
- **rental-checklists** - Templates CRUD with activate/deactivate toggle, assign to rental (active-only), check/uncheck items per rental, soft delete/restore
- **rental-policies** - Global policy settings (buffer days, late fees, etc.)
- **flash-sales** - Time-limited sales CRUD with product pricing, soft delete/restore. Schema fields: `endDate` (not `endTime`), items via `FlashSaleItem` relation with `salePrice` + nested `product`
- **payment-methods** - DB-driven payment method CRUD (`PaymentMethod` model). 1 public endpoint (`GET /payment-methods` — active only), 7 admin endpoints (create, update, toggle-active, soft delete, restore, deleted list). Icon upload via `POST /upload/payment-icon` (2MB, JPEG/PNG/WebP/SVG → `uploads/payment-methods/`). Seeded: Visa, Mastercard, M-Pesa, Tigo Pesa, Airtel Money, Selcom Pesa, Halopesa.
- **referrals** - Referral code tracking and stats
- **id-verification** - National ID upload, admin approve/reject
- **cms** - Banners (soft delete/restore), pages (soft delete/restore), site settings CRUD. `GET /cms/settings/business-profile` returns all business profile fields including `mapLatitude`, `mapLongitude` (from SiteSetting key-value store). `GET /cms/storefront-stats` (public, tenant-scoped) returns `{ productCount, rentalCount, customerCount }` for live hero stats on the storefront homepage
- **analytics** - Dashboard stats, revenue charts (daily/weekly/monthly)
- **notifications** - Email + SMS sending
- **upload** - Local file upload. `POST /upload/product-image` → `uploads/products/` (JPEG/PNG/WebP, 5MB). `POST /upload/payment-icon` → `uploads/payment-methods/` (JPEG/PNG/WebP/SVG, 2MB). ServeStaticModule serves all `/uploads` paths.
- **pos** - POS shift management and sales
- **scheduler** - Cron jobs for rental prep reminders (8am daily), overdue rental alerts (9am daily), pending return reminders (8:30am daily, 3-day window)
- **permissions** - 40+ granular permissions, seeded on startup via OnModuleInit
- **roles** - RBAC roles (SUPER_ADMIN, MANAGER, STAFF seeded as isSystem=true), custom roles CRUD, permission matrix
- **admin-users** - Admin user CRUD, toggle active, unlock locked accounts, assign/remove roles, self-role protection
- **audit** - Global audit trail system. `AuditService` (global, request-scoped, fire-and-forget) logs admin actions to `AdminActivityLog`. `AuditController`: `GET /audit` (paginated, filtered), `GET /audit/filters` (dropdown options), `GET /audit/export` (CSV download, max 10K rows). 29 log points across 8 services (products, categories, orders, rentals, CMS, flash-sales, roles, inventory). Usage: `await this.auditService.log('CREATE', 'Product', product.id, { name })`
- **expense-categories** - DB-stored expense categories, CRUD, toggle, soft delete/restore; default categories seeded on startup
- **expenses** - Business expense CRUD, period auto-computed from expenseDate as "YYYY-MM", summary by period
- **inventory** - Products with stock levels, low-stock alerts, valuation, transaction history, stock adjustments (atomic via $transaction)
- **reports** - Rental reports by product, income statement (P&L), monthly financial summary, expense breakdown, financial periods (OPEN/CLOSED/LOCKED)
- **newsletter** - Subscriber management (subscribe/unsubscribe with token), newsletter CRUD (DRAFT/SENDING/SENT/FAILED), 4 template types (NEW_ARRIVALS auto-populates unsent products, NEW_DEALS, TIPS, CUSTOM), async delivery with 200ms rate limiting, per-recipient tracking (SENT/FAILED with failureReason), failed resend, dashboard stats. 15 endpoints (2 public: subscribe + unsubscribe, 13 admin).

## Instagram Graph API Integration
- `InstagramService` in `src/cms/instagram.service.ts` syncs posts from Facebook Graph API v25.0
- Uses `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID` from env
- Endpoint: `POST /cms/instagram-posts/sync` (manual trigger) + cron every 6 hours
- Token auto-refresh on 1st & 15th of month via `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET`
- Refreshed token stored in `SiteSetting` table for persistence
- Post ordering: API (newest by postedAt) → Pinned (by sortOrder) → Manual (by sortOrder)
- `PATCH /cms/instagram-posts/:id/pin` toggles pin status

## Analytics API
- `GET /analytics/dashboard` - Returns: totalRevenue, totalOrders, customerCount, activeRentals, rentalRevenue, avgOrderValue, percentage changes, topProducts (enriched with names), categoryBreakdown, orderStatusDistribution, paymentMethodDistribution, customerGrowth, rentalStatusDistribution, dailyOrders
- `GET /analytics/revenue?period=daily|weekly|monthly` - Returns combined sales + rental revenue grouped by period

## Soft Delete Pattern
- Major entities (Product, Category, FlashSale, Banner, Page, ChecklistTemplate, ExpenseCategory, Role, AdminUser) use `deletedAt DateTime?` for soft delete
- DELETE endpoints set `deletedAt = now()` and `isActive = false` instead of removing from DB
- Public GET endpoints filter `deletedAt: null` to hide deleted items from customers
- Admin can view deleted items via `GET .../deleted` and restore via `PATCH .../:id/restore`
- Products and checklist templates have `PATCH .../:id/toggle-active` to activate/deactivate

## RBAC Design
- Permission (module:action code) → RolePermission (join) → Role → AdminUserRole (join) → AdminUser
- AdminUser.role string kept for JWT payload (backward compat); granular roles via AdminUserRole
- System roles (SUPER_ADMIN, MANAGER, STAFF) seeded on startup, cannot be deleted or renamed
- Self-role protection enforced at service layer: `if (targetId === performedById) throw ForbiddenException`
- Account lockout: 5 failed attempts → lockedUntil +30min; cleared on success or manual unlock
- Password reset: rawToken → SHA-256 hash stored, 30-min expiry, single-use

## Conventions
- Each feature is a NestJS module in `src/`
- Use Prisma client from `@naro/database` for all DB access
- Use DTOs with class-validator for request validation
- Use `JwtAuthGuard` for protected endpoints
- RESTful endpoint naming under `/api/v1/`
- **All new services MUST inject TenantContext and scope queries with tenantId**
- **All new optional-module controllers MUST use `@RequiresModule('code')` + `ModuleGuard`**
- Do NOT import from `@naro/shared` in API services — ESM/CJS mismatch causes runtime crash
- Catch Prisma P2002 (unique constraint) → throw ConflictException (409)

## Database
- Connection string in `.env` and `packages/database/.env`
- Schema in `packages/database/prisma/schema.prisma`
- Generate client: `cd packages/database && pnpm prisma generate`
