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
- Token storage depends on "Remember me" checkbox: checked → `localStorage` (persists), unchecked → `sessionStorage` (cleared on browser close). API client checks both.
- Admin also supports cookies (httpOnly access_token + refresh_token)
- Default credentials: Admin `admin@narofashion.co.tz` / `admin123`, Platform `platform@naro.co.tz` / `Admin123`

## Tenant Data Scoping
- `TenantContext` (request-scoped injectable in `apps/api/src/tenant/tenant.context.ts`) — provides `tenantId` to all services
- `TenantInterceptor` (global) — extracts tenantId from JWT or `X-Tenant-Id` header, sets `request.tenantId`
- All 26 tenant-scoped services use `this.tenantContext.requireId` in Prisma queries
- **`requireId` throws 400 not 500**: When tenant context is missing, `TenantContext.requireId` throws `BadRequestException` with an actionable message ("Provide X-Tenant-Id header or a valid Authorization token") — cleaner public API responses for unauthenticated callers.
- **JWT fallback for @Public() endpoints**: Both `TenantContext` and `ModuleGuard` decode the JWT from the `Authorization` header when `req.user` is not populated (because `@Public()` skips `JwtAuthGuard`). This allows admin users to call public CMS/product/category endpoints with tenant scoping.
- **Guards**:
  - `TenantGuard` — validates tenant is ACTIVE, attaches tenantId to request
  - `ModuleGuard` — checks `@RequiresModule('moduleName')` decorator against TenantModule table (5-min cache). Decodes JWT payload directly from Authorization header for @Public() endpoints.
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
- **Instagram Feed**: Auto-syncs from Facebook Graph API. Configurable sync interval via admin (OFF/hourly/3h/6h/12h/daily/weekly) stored in SiteSetting `instagram_sync_interval`. Dynamic cron via `SchedulerRegistry`. Default: every 6 hours
- **Newsletter**: Full email campaign platform with subscriber management and delivery tracking
- **Subscription Lifecycle**: Daily cron checks expiry → GRACE (7 days) → SUSPENDED. Reminders at 7, 3, 1 days before expiry
- **Google Maps on Contact Page**: Configurable via Business Profile settings (`map_latitude`, `map_longitude` in SiteSetting). Admin can enter coordinates manually or auto-detect via browser geolocation. Storefront contact page shows embedded Google Map only when valid coordinates exist. Validation: lat -90..90, lng -180..180, minimum 2 decimal places, both required if either set.
- **Storefront Hero Stats**: Dynamic counts from database via `GET /cms/storefront-stats` (public, tenant-scoped). Returns `{ productCount, rentalCount, customerCount }` based on active products, rental-eligible products (RENTAL_ONLY/BOTH), and active customers. Each stat on the hero section only renders when count > 0 (no fake placeholder numbers).
- **Bulk Product Import**: Admin products page has "Template" (client-side CSV download with headers + 2 example rows) and "Import CSV" buttons. `POST /products/bulk-import` (multipart, 5MB/500 rows max) parses CSV, resolves categories by slug or name, validates per row (required fields, numeric price, valid availability mode, duplicate SKU check), and returns `{ created, failed, total, errors[] }` with row-level feedback.
- **Platform Payments Page**: `/platform/payments` shows all tenant billing payments across the platform with summary cards (Completed/Pending totals), status filter, search, and CSV export. Powered by `GET /tenants/payments?status=` (platform-admin-only).
- **Customer Admin Endpoints**: `GET /users` (admin) lists all tenant customers with order/rental counts and total spent (aggregated). `PATCH /users/:id/suspend` and `PATCH /users/:id/activate` manage customer status.
- **Homepage CMS Content**: All homepage section text is admin-editable via `/dashboard/cms/settings` with English + Swahili variants. Rental section perks (e.g. "Designer gowns", "Cleaning included") live in `rental_section_features` SiteSetting as newline-separated items — each line becomes a pill on the storefront.
- **Hero Slides**: Admin-managed at `/dashboard/cms/hero-slides`; stored in `HeroSlide` table per tenant (`{ id, tenantId, title, imageUrl, sortOrder, isActive, deletedAt }`). Storefront renders a two-layer hero: a blurred, zoomed `backdrop` (filter: blur(42px) brightness(0.55) saturate(1.25) + scale 1.15) fills the viewport and a **sharp `foreground` card at natural aspect-[3/4]** sits on top. This keeps portrait bridal photos looking intentional even when the hero is wide landscape — never stretch a gown with `object-cover` over an aspect-[16/9] box. The foreground card has rotating orbit rings (`animate-hero-orbit`), a pulsing gold ring (`animate-hero-ring-pulse`), and the image uses Ken Burns zoom on the active slide only.
- **Shop by Category tiles**: `GET /api/v1/categories` returns `fallbackImageUrl` (first product image from the category or any descendant, in `imageByCategoryId` map keyed by categoryId) and `totalProductCount` (direct + descendant products rolled up). Parent categories like "Wedding Dresses" have 0 direct products — products live in `Ball Gown` / `Mermaid` / `Plus-Size` subcategories — so the storefront shows a real gown photo + "14 items" by surfacing those through the fallback. Tiles sort by `totalProductCount` desc before slicing top 4. When no image is resolvable, the tile renders a gold-on-dark gradient placeholder with the category initial instead of a broken `<img>`. **Never use `/uploads/categories/<slug>.jpg` as a fallback path** — those stock files were deleted from the VPS, referencing them produces 404s.

## API Modules
analytics, audit, auth, cart, categories, cms, events, flash-sales, id-verification, newsletter, notifications, orders, payment-methods, payments, products, promo-codes, referrals, rental-checklists, rental-policies, rentals, reviews, scheduler, shipping, size-guides, upload, users, wishlist, permissions, roles, admin-users, expense-categories, expenses, inventory, reports, pos, tenants

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

## Production Deployment
- **VPS**: Vultr vhf-1c-2gb (1 vCPU, 2GB RAM, 64GB NVMe) in Frankfurt, DE — $12/mo
- **Server IP**: `80.240.30.107`
- **Domain**: `narofashion.co.tz` (storefront), `admin.narofashion.co.tz` (admin), `api.narofashion.co.tz` (API)
- **Domain registrar**: Habari Node (habari.co.tz) — nameservers pointed to `ns1.vultr.com` / `ns2.vultr.com`
- **DNS**: Managed via Vultr DNS (my.vultr.com/dns/) — A records for `@`, `www`, `admin`, `api` → `80.240.30.107`
- **Stack**: Ubuntu 24.04, Node.js 22, PM2, Nginx, PostgreSQL 16, Let's Encrypt SSL
- **Email**: Brevo SMTP (smtp-relay.brevo.com, 300/day free). Sender: `Naro Fashion <noreply@narofashion.co.tz>`. Domain authenticated with SPF, DKIM, DMARC.
- **Process manager**: PM2 with `ecosystem.config.js` (standalone Next.js + NestJS dist)
- **Next.js output**: `standalone` mode — apps run from `.next/standalone/apps/<name>/server.js`
- **Static assets**: Must be copied to standalone dir after each build (`cp -r .next/static .../.next/static` + `cp -r public .../public`)
- **Deploy command**: `./deploy.sh` or `git pull && pnpm install && pnpm build && pm2 restart all`
- **TypeScript**: Both Next.js apps build with `typescript: { ignoreBuildErrors: false }` — strict type checking enforced in production. All TS errors have been fixed.
- **Build notes**: Both Next.js apps use `eslint: { ignoreDuringBuilds: true }`, `output: 'standalone'`, and root layout has `export const dynamic = "force-dynamic"` to prevent prerender errors
- **CI/CD**: Push to `prod` branch triggers automatic deployment via GitHub Actions (`.github/workflows/deploy-prod.yml`). Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- **Multer**: Must be explicitly installed (`pnpm add multer @types/multer --filter api`) — not auto-resolved from pnpm hoisting
- **Untracked files on the VPS block `git pull` on deploy**: if you've `scp`'d helper scripts (or anything else) into `/var/www/naro-fashion/` and later commit files at the same paths, the next deploy fails with `error: The following untracked working tree files would be overwritten by merge`. Fix by either (a) `scp`ing to `/tmp/` instead for one-off work, or (b) `ssh root@80.240.30.107 "cd /var/www/naro-fashion && rm -f <paths>"` before pushing the commit that tracks them. `gh run view <id> --log-failed` surfaces this specific git-pull error immediately.
- **Data-change scripts run separately from deploy**: `deploy.sh` does code-only (git pull, pnpm install, prisma generate/push, build, PM2 restart). It does NOT run seeds, imports, or backfills. Commit any backfill script under `scripts/` and SSH in to run it once (`ssh root@... "cd /var/www/naro-fashion && node scripts/<name>.js"`). Prisma client resolution from scripts needs the explicit path: `require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'))` — don't rely on hoisting from `/tmp`.
- **Bulk-import photo gotcha**: `scripts/bulk-import-products.js` copies photos from `docs/photo-staging/` (and `docs/instagram/`) into `apps/api/uploads/products/`. Those source folders are intentionally `.gitignore`d (source material, not ship artifacts), so the script **fails on the VPS** with "Photo not found". The pattern for production: commit the destination files (`apps/api/uploads/products/{slug}-NN.jpg`) from local, then run `scripts/backfill-product-images.js` on the VPS — it scans the committed uploads dir for `{slug}-NN.(jpg|jpeg|png)` and creates the matching `ProductImage` rows. Idempotent — skips URLs that already have rows.
- **Deployment guide**: `docs/DEPLOYMENT_GUIDE.md` (2,160 lines, 16 parts + 2 appendices) and `docs/DEPLOYMENT_GUIDE.pdf` — comprehensive battle-tested guide covering VPS provisioning, build troubleshooting (9 documented errors), CI/CD, email setup, and all challenges encountered during real deployments.

## Documentation
All documentation lives in `docs/` with Markdown source and PDF/DOCX/PPTX exports:
- `docs/SYSTEM_DESIGN.md` (.pdf, .docx) — Architecture, multi-tenancy, data flow, state machines, scalability
- `docs/DATABASE_SCHEMA.md` (.pdf, .docx) — All 57+ models, 5 ER diagrams, indexes, unique constraints, enums
- `docs/API_REFERENCE.md` (.pdf, .docx) — All 34 modules, 306 endpoints, curl examples, SDK samples
- `docs/TECHNICAL_GUIDE.md` (.pdf, .docx) — Dev setup, coding patterns, recipes, troubleshooting
- `docs/USER_GUIDE.md` (.pdf, .docx) — 3-part guide: customer, tenant admin, platform admin (with wireframes)
- `docs/SECURITY.md` (.pdf, .docx) — Threat model, auth security, data isolation, compliance, incident response
- `docs/OPERATIONS_RUNBOOK.md` (.pdf, .docx) — Health checks, deployment, incident response, backup/recovery
- `docs/NARO_FASHION_PITCH_DECK.md` (.pdf, .pptx) — 30-slide marketing pitch deck (Marp format, Black+Gold theme)
- `docs/DEPLOYMENT_GUIDE.md` (.pdf) — Production server setup and deployment procedures
- `docs/INSTAGRAM_INTEGRATION_GUIDE.md` — Facebook Graph API integration
- `docs/3d-product-view-plan.md` — Google model-viewer implementation plan
- PDF conversion: `md-to-pdf <file>.md` (globally installed)
- DOCX conversion: `pandoc <file>.md -o <file>.docx` (globally installed)
- PPTX conversion: `marp <file>.md --pptx` (globally installed via @marp-team/marp-cli)

## Env File Sprawl (Production Gotcha)
Three `.env` files are loaded on the API at boot and they do NOT merge cleanly:
1. `/var/www/naro-fashion/.env` (root)
2. `/var/www/naro-fashion/apps/api/.env`
3. `/var/www/naro-fashion/packages/database/.env`

Prisma's internal `dotenv` call runs FIRST (when `PrismaClient` is imported), and `dotenv` never overrides an already-set env var. So any value Prisma's `.env` sets wins, and the later `@nestjs/config` call is a no-op for that key. This burned a www-CORS fix: `STOREFRONT_URL` was correct in two of three `.env` files but the `packages/database/.env` still had the apex-only value, so `https://www.narofashion.co.tz` requests got no `Access-Control-Allow-Origin` header.

**Rules of thumb**:
- Duplicated env keys must be consistent across all three files.
- `STOREFRONT_URL` supports comma-separated origins for multi-origin CORS: `STOREFRONT_URL="https://narofashion.co.tz,https://www.narofashion.co.tz"`.
- When CORS or env behavior looks wrong after a deploy and `pm2 restart` doesn't fix it, hot-patch `dist/main.js` with a `console.log(process.env.FOO)` to see the actual runtime value before blaming the code.
- PM2's `ecosystem.config.js` only sets `NODE_ENV` + `PORT` — don't assume it provides app env vars.

## Known Issues
- Global Prisma CLI is v7.4.2 which has breaking changes — always use local Prisma v6.19.2 via `pnpm prisma` from `packages/database/`
- OneDrive sync can cause EPERM errors during `prisma generate` — retry usually works, or use `prisma db push` which also triggers generate
- Recharts must be dynamically imported with `{ ssr: false }` in Next.js to avoid SSR issues
- API response fields may be undefined when database has no data — always use `?? 0`, `|| '0%'`, `|| []` fallbacks
- RBAC: Permission → RolePermission → Role → AdminUserRole → AdminUser; `AdminUser.role` string kept for JWT backward compat
- Account lockout: 5 failed login attempts → 30-min lock; tracked in `AdminUser.lockedUntil` + `LoginAttempt` table
- `tenantId` is currently nullable (`String?`) in schema — will be made required after full migration. All services already treat it as required via `TenantContext.requireId`
- Storefront API calls that bypass the API client (raw `fetch`) must manually include `X-Tenant-Id` header from the `tenantId` cookie
- Prisma `_count` must be included at **every** nesting level of a nested relation query — declaring it only at the parent returns 0 at deeper levels. Example: `categories.findAll()` includes `_count: { products: ... }` on parent, children, and grandchildren. Always also filter the counted relation by `deletedAt: null` so soft-deleted rows don't inflate counts.
- For rolled-up counts and descendant fallbacks (e.g. "parent category with no direct products needs the subcategory count + first product photo"), don't try to do it inside the Prisma query. Collect all descendant IDs with a small recursive walker, run one extra `product.findMany({ where: { categoryId: { in: allIds } } })` sorted by `createdAt desc`, build a `Map<categoryId, firstImageUrl>`, then recursively attach `fallbackImageUrl` + `totalProductCount` in application code. See `CategoriesService.findAll()` for the canonical pattern.
- Admin UI must tolerate both legacy and Prisma-native field names when the API passes the Prisma response through unchanged (e.g. category `name` / `nameSwahili` vs older `nameEn` / `nameSw`, and `_count.products` vs `productCount`). Use `a ?? b` fallbacks.
- `<model-viewer>` web component requires `types/model-viewer.d.ts` type declaration in both admin and storefront. Must be dynamically imported (never SSR'd). Use `next/dynamic` with `ssr: false` on storefront.
