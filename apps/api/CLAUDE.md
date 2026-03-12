# API (NestJS)

REST API backend for Naro Fashion. Runs on port 4000, prefix `/api/v1`.

## Stack
- NestJS, TypeScript, Prisma ORM, PostgreSQL 17
- Passport.js + JWT for authentication
- class-validator + class-transformer for DTOs
- Local file storage for image uploads (ServeStaticModule serves `/uploads`), Multer for multipart
- @nestjs/serve-static for serving uploaded files

## Authentication
- Dual-table auth: `User` (customers) and `AdminUser` (admin staff)
- `validateUser()` checks both tables, returns `isAdmin: true` for AdminUser
- `generateTokens()` includes `isAdmin` and `role` in JWT payload
- `JwtStrategy.validate()` checks AdminUser first if `payload.isAdmin`, then User, then AdminUser fallback
- Endpoints: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`
- Profile: `GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`, `PATCH /auth/2fa`
- Password reset: `POST /auth/forgot-password`, `POST /auth/reset-password`
- Account lockout: 5 failed attempts → lockedUntil = +30min, auto-unlocks; logged to LoginAttempt table

## Modules (all fully implemented)
- **auth** - Login, register, JWT access/refresh tokens, profile, password change, 2FA toggle, forgot/reset password, account lockout
- **users** - User CRUD, addresses, suspend/activate
- **products** - Full CRUD with variants, images, search, filtering, toggle active, soft delete/restore, admin listing (includes inactive), purchasePrice/minimumStock/supplier fields, `GET /products/by-id/:id` for edit page
- **categories** - Nested category tree CRUD, soft delete/restore
- **cart** - Add/update/remove items, merge guest cart, count
- **wishlist** - Toggle, check, count
- **orders** - Create from cart, status workflow, admin listing, stats
- **payments** - Create, update status, webhooks, payment summary
- **shipping** - Zones CRUD, rate calculation, shipment tracking
- **reviews** - Create, approve/reject, rating stats, product aggregation
- **rentals** - Booking, availability check, status workflow, upcoming pickups
- **rental-checklists** - Templates CRUD with activate/deactivate toggle, assign to rental (active-only), check/uncheck items per rental, soft delete/restore
- **rental-policies** - Global policy settings (buffer days, late fees, etc.)
- **flash-sales** - Time-limited sales CRUD with product pricing, soft delete/restore
- **referrals** - Referral code tracking and stats
- **id-verification** - National ID upload, admin approve/reject
- **cms** - Banners (soft delete/restore), pages (soft delete/restore), site settings CRUD
- **analytics** - Dashboard stats, revenue charts (daily/weekly/monthly)
- **notifications** - Email + SMS sending
- **upload** - Local file upload (saves to `uploads/products/`, validates type jpeg/png/webp and 5MB max, Multer FileInterceptor)
- **pos** - POS shift management and sales
- **scheduler** - Cron jobs for reminders and overdue alerts
- **permissions** - 40+ granular permissions, seeded on startup via OnModuleInit
- **roles** - RBAC roles (SUPER_ADMIN, MANAGER, STAFF seeded as isSystem=true), custom roles CRUD, permission matrix
- **admin-users** - Admin user CRUD, toggle active, unlock locked accounts, assign/remove roles, self-role protection
- **expense-categories** - DB-stored expense categories, CRUD, toggle, soft delete/restore; default categories seeded on startup
- **expenses** - Business expense CRUD, period auto-computed from expenseDate as "YYYY-MM", summary by period
- **inventory** - Products with stock levels, low-stock alerts, valuation, transaction history, stock adjustments (atomic via $transaction)
- **reports** - Rental reports by product, income statement (P&L), monthly financial summary, expense breakdown, financial periods (OPEN/CLOSED/LOCKED)

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
- Shared types/enums from `@naro/shared`
- Catch Prisma P2002 (unique constraint) → throw ConflictException (409)

## Database
- Connection string in `.env` and `packages/database/.env`
- Schema in `packages/database/prisma/schema.prisma`
- Generate client: `cd packages/database && pnpm prisma generate`
