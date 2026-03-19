# Naro Fashion - Multi-Tenant SaaS Platform

## Project Overview
Multi-tenant SaaS e-commerce platform for fashion & clothing businesses.
Shared database with row-level tenant isolation (`tenantId` on all models).
Target market: Tanzania (local payment methods, Swahili translations).
GitHub: https://github.com/rjurio/naro-fashion

## Architecture
- `apps/storefront/` - Customer-facing Next.js PWA (port 3000) — tenant-resolved via custom domain
- `apps/admin/` - Admin dashboard Next.js (port 3001) — tenant admin + platform admin
- `apps/api/` - NestJS REST API (port 4000, prefix `/api/v1`) — all queries scoped by tenantId
- `packages/database/` - Prisma schema + client (PostgreSQL, 50+ models)
- `packages/shared/` - Shared types, enums, constants, module definitions
- `packages/ui/` - Shared UI components

## Multi-Tenancy
- **Data isolation**: Shared database, `tenantId` field on all tenant-scoped models (row-level isolation)
- **Tenant resolution**: Storefront middleware resolves tenant by custom domain or slug fallback (`NEXT_PUBLIC_TENANT_SLUG` env var for local dev)
- **Three-tier auth**: PlatformAdmin → AdminUser (tenant) → User (customer)
- **Module system**: `TenantModule` table controls which features each tenant can access. Core modules always enabled. Optional modules gated by `@RequiresModule()` decorator + `ModuleGuard`
- **Subscription billing**: SubscriptionPlan → TenantSubscription → TenantPayment. Plans: Starter (50K TZS/mo), Business (150K), Enterprise (350K)
- **Platform admin**: `/platform-login` → `/platform/*` routes in admin app. Manages tenants, plans, billing, modules

## Tech Stack
- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15+ (App Router), TypeScript, Tailwind CSS v4, next-themes
- **Backend**: NestJS 11, Prisma ORM, PostgreSQL 17
- **Auth**: JWT (access + refresh tokens), Passport.js, three-tier auth (PlatformAdmin + AdminUser + User)
- **Charts**: Recharts (dynamically imported with `ssr: false` to avoid SSR issues)
- **Languages**: English + Swahili (i18n via custom I18nProvider)
- **Brand Colors**: Per-tenant via TenantBranding (defaults: Black #1A1A1A, Gold #D4AF37)
- **Themes**: Storefront `data-theme`: light|dark|standard. Admin `class`: light|dark|luxury

## Commands
- `pnpm dev` - Start all apps in dev mode
- `pnpm build` - Build all packages/apps
- `pnpm lint` - Lint all packages/apps
- `pnpm db:generate` - Generate Prisma client (run from `packages/database/`)
- `pnpm db:push` - Push schema to database
- `pnpm db:migrate` - Run Prisma migrations
- `pnpm db:studio` - Open Prisma Studio

## Database
- PostgreSQL 17, database: `naro_fashion`, user: `naro_admin`, password: `Admin123`
- Schema lives in `packages/database/prisma/schema.prisma`
- 50+ models including multi-tenant models: Tenant, PlatformAdmin, TenantBranding, SubscriptionPlan, TenantSubscription, TenantPayment, TenantModule
- All tenant-scoped models have `tenantId String?` field with `@@index([tenantId])`
- Unique constraints are per-tenant: `@@unique([tenantId, slug])`, `@@unique([tenantId, code])`, etc.
- Seed scripts in `packages/database/prisma/`: `migrate-to-multi-tenant.js`, `seed-tenant.js`, `seed-mock-data.js`

## Authentication
- **Three-tier auth**:
  - `PlatformAdmin` — platform-level superusers, manage all tenants. Login: `POST /auth/platform-login`
  - `AdminUser` — tenant staff (SUPER_ADMIN, MANAGER, STAFF). Email globally unique. Login: `POST /auth/login`
  - `User` — customers, scoped per tenant. Email unique per tenant. Login: `POST /auth/login` with `X-Tenant-Id` header
- JWT payload: `{ sub, email, tenantId?, isAdmin?, isPlatformAdmin?, role? }`
- Token stored in `localStorage('token')`, auto-injected as Bearer header
- Admin also supports cookies (httpOnly access_token + refresh_token)
- Default credentials: Admin `admin@narofashion.co.tz` / `admin123`, Platform `platform@naro.co.tz` / `Admin123`

## Tenant Data Scoping
- `TenantContext` (request-scoped injectable in `apps/api/src/tenant/tenant.context.ts`) — provides `tenantId` to all services
- `TenantInterceptor` (global) — extracts tenantId from JWT or `X-Tenant-Id` header, sets `request.tenantId`
- All 26 tenant-scoped services use `this.tenantContext.requireId` in Prisma queries
- **Guards**:
  - `TenantGuard` — validates tenant is ACTIVE, attaches tenantId to request
  - `ModuleGuard` — checks `@RequiresModule('moduleName')` decorator against TenantModule table (5-min cache)
  - `PlatformAdminGuard` — restricts endpoints to platform admins only
- **Core modules** (always enabled): products, categories, orders, cart, wishlist, cms, auth, users, shipping
- **Optional modules** (gated): rentals, rental-checklists, rental-policies, pos, analytics, inventory, expenses, reports, flash-sales, referrals, events, promo-codes, id-verification

## Key Domain Concepts
- **3D Product View**: Optional per-product interactive 3D viewer using Google `<model-viewer>`. Admin uploads GLB/GLTF files (25MB limit). Storefront shows Photos/3D toggle with lazy-loaded viewer. Built-in AR on mobile. Poster image fallback to primary product photo.
- **Rental System**: Gowns/formal wear rentals with National ID verification, 25% down payment, 7-day buffer between rentals, admin checklists (DISPATCH + RETURN), wedding details, transport receipt upload, automated reminders
- **Product Availability**: PURCHASE_ONLY, RENTAL_ONLY, or BOTH
- **Payments**: Mobile Money (M-Pesa, Tigo Pesa, Airtel Money), cards, bank transfer, COD. DB-managed via PaymentMethod model
- **POS**: Point of Sale with shift management, barcode scan, split payments, layaway, exchanges
- **Customer Events**: Wedding gallery showcases with media, approval workflow
- **Soft Delete**: Major entities use `deletedAt` field → Recycle Bin in admin
- **Instagram Feed**: Auto-syncs from Facebook Graph API. Cron every 6 hours
- **Newsletter**: Full email campaign platform with subscriber management and delivery tracking
- **Subscription Lifecycle**: Daily cron checks expiry → GRACE (7 days) → SUSPENDED. Reminders at 7, 3, 1 days before expiry

## API Modules
analytics, auth, cart, categories, cms, events, flash-sales, id-verification, newsletter, notifications, orders, payment-methods, payments, products, promo-codes, referrals, rental-checklists, rental-policies, rentals, reviews, scheduler, shipping, size-guides, upload, users, wishlist, permissions, roles, admin-users, expense-categories, expenses, inventory, reports, pos, tenants

## Frontend Data Flow
- Storefront: `apps/storefront/middleware.ts` resolves tenant by domain → sets `tenantId` cookie → API client reads cookie and injects `X-Tenant-Id` header
- Admin: tenantId flows via JWT (AdminUser has tenantId) — no explicit header needed
- Platform admin: no tenantId in JWT, bypasses all tenant guards
- Storefront API client: `apps/storefront/lib/api.ts` (reads tenantId from cookie)
- Admin API client: `apps/admin/lib/api.ts` (AdminApiClient class with tenant/platform methods)
- Admin AuthContext: `apps/admin/contexts/AuthContext.tsx` — provides `isPlatformAdmin`, `enabledModules`, `isModuleEnabled()`

## Coding Conventions
- Use TypeScript strict mode everywhere
- Shared types/enums go in `packages/shared/`, not duplicated across apps
- **IMPORTANT**: Do NOT import from `@naro/shared` in NestJS API services (ESM/CJS incompatibility). Define constants locally in the API if needed.
- API endpoints follow RESTful conventions in NestJS modules
- Use Prisma for all database access — no raw SQL unless absolutely necessary
- Use DTOs with class-validator for request validation in API
- All new services MUST include `TenantContext` and scope queries with `tenantId`
- All new controllers for optional modules MUST use `@RequiresModule('module-code')` + `ModuleGuard`
- Prefer open-source and free-tier solutions
- When importing `Image` from both `next/image` and `lucide-react`, alias lucide's as `ImageIcon`

## Known Issues
- Global Prisma CLI is v7.4.2 which has breaking changes — always use local Prisma v6.19.2 via `pnpm prisma` from `packages/database/`
- OneDrive sync can cause EPERM errors during `prisma generate` — retry usually works, or use `prisma db push` which also triggers generate
- Recharts must be dynamically imported with `{ ssr: false }` in Next.js to avoid SSR issues
- API response fields may be undefined when database has no data — always use `?? 0`, `|| '0%'`, `|| []` fallbacks
- RBAC: Permission → RolePermission → Role → AdminUserRole → AdminUser; `AdminUser.role` string kept for JWT backward compat
- Account lockout: 5 failed login attempts → 30-min lock; tracked in `AdminUser.lockedUntil` + `LoginAttempt` table
- `tenantId` is currently nullable (`String?`) in schema — will be made required after full migration. All services already treat it as required via `TenantContext.requireId`
- Storefront API calls that bypass the API client (raw `fetch`) must manually include `X-Tenant-Id` header from the `tenantId` cookie
- `<model-viewer>` web component requires `types/model-viewer.d.ts` type declaration in both admin and storefront. Must be dynamically imported (never SSR'd). Use `next/dynamic` with `ssr: false` on storefront.
