# API (NestJS)

REST API backend for Naro Fashion. Runs on port 4000, prefix `/api/v1`.

## Stack
- NestJS 11, TypeScript, Prisma ORM, PostgreSQL 17
- Passport.js + JWT for authentication
- class-validator + class-transformer for DTOs
- Local file storage for image uploads (ServeStaticModule serves `/uploads`), Multer for multipart
- @nestjs/serve-static for serving uploaded files

## AI Admin Agent (Phase 1 — read-only)
Lives at `src/ai/`. Adds 17 GET endpoints under `/api/v1/ai/*`, all read-only by design and enforced both at runtime (no write decorators) and at build time (`ai-controllers.shape.spec.ts` invariant).

**Architecture**:
- `services/ai-tool-runner.service.ts` (request-scoped) — wraps every controller handler with timing → audit → envelope. Controllers call `this.runner.run({ tool, actionType: 'READ', input, handler: () => existingService.method(...) })`.
- `services/ai-audit.service.ts` (request-scoped) — writes one row per call to `AgentAuditLog`. Pulls `adminUserId`, `tenantId`, IP, UA, and the `X-Agent-Session-Id` header (capped at 64 chars). Swallows its own errors so a broken audit never breaks a tool call.
- `services/ai-sanitizer.service.ts` — strips `password*`, `secret*`, `accessToken`, `refreshToken`, `apiKey`, `clientSecret`, `webhookSecret`, `Authorization`, `Bearer`, `cardNumber`/`cvv`/`pin` keys (case-insensitive, normalises `_`/`-`). **Preserves `approvalToken`** (allow-listed for forensics — already consumed by the time it reaches the audit log). Bounds: strings >4KB truncated, arrays >200 items truncated, whole payload >64KB summarised.
- `guards/ai-permission.guard.ts` — DB-checks `AdminUserRole → Role → RolePermission → Permission(code='ai-agent:use', isActive: true)`. Platform admins bypass. **Permission is NOT auto-granted to any seeded role** — operators must assign it.
- `filters/ai-exception.filter.ts` — catches every error thrown inside an AI route and re-shapes into `{success:false, tool, error:{code, message}, approvalRequired:false, auditId}` while preserving the HTTP status code. Maps 400→`validation_error`, 401→`unauthorized`, 403→`permission_denied`, 404→`not_found`, 409→`conflict`, 422→`unprocessable`, 429→`rate_limited`, 5xx→`server_error`.
- `common/ai-controller.decorators.ts` — `@AiSecured()` bundles `JwtAuthGuard, AdminGuard, AiPermissionGuard` + the filter. Inventory and Reports controllers wire `ModuleGuard` + `@RequiresModule()` explicitly because `@AiSecured()` can't carry the per-controller module metadata.

**Endpoints (all GET, all read-only)**: products (search, :id), categories, product-sizes, orders (list, :id), rentals (list, :id), inventory + low-stock (module-gated), rental-policies, size-guide, recycle-bin (Phase 1: Product/Category/ProductSize/SizeGuide), reports/{sales,rental,inventory}-summary + popular-products + pending-orders + overdue-rentals (module-gated). Full list in `docs/ai-agent/AI_TOOLS.md`.

**Conventions for new AI tools**:
- Always go through `AiToolRunner.run()` — never write to `AgentAuditLog` directly. The runner sets timing, severity, and envelope shape uniformly.
- Pass the `actionType` per the AgentAuditLog enum: `READ | CREATE | UPDATE | DELETE | RESTORE | PUBLISH | ARCHIVE | STATUS_CHANGE | ADJUST_INVENTORY | NOTE`.
- Reuse existing service methods. Don't reimplement business logic in the AI layer — that's the whole point of the architecture.
- Each new endpoint needs a permission. Add it to `permissions.service.ts` PERMISSIONS list so it gets seeded on next boot. Phase 1 added: `ai-agent:use, product-sizes:view, size-guides:view, rental-policies:view, recycle-bin:list`.
- Module-gated endpoints (anything that wraps a `@RequiresModule()` controller) MUST also wire `ModuleGuard` + `@RequiresModule()` on the AI controller — otherwise tenants without the module enabled can hit the AI surface.

**Phase roadmap** (`docs/ai-agent/IMPLEMENTATION_PLAN.md`):
- Phase 2: draft creation tools (create_product_draft, add_order_note, draft size guide entries) — no approval needed because drafts are reversible.
- Phase 3: approval-gated writes via new `AgentApprovalRequest` table (two-phase commit, single-use 5-min token, 60-second token for permanent-delete).
- Phase 4: full CRUD + recycle-bin restore/permanent-delete + reports export.

## Multi-Tenancy
- **TenantContext** (`src/tenant/tenant.context.ts`): Request-scoped injectable providing `tenantId`. Use `this.tenantContext.requireId` in all Prisma queries. Falls back to decoding JWT from `Authorization` header when `req.user` is not set (for `@Public()` endpoints). `requireId` throws `BadRequestException` (400) with actionable message ("Provide X-Tenant-Id header or a valid Authorization token") instead of generic 500 — cleaner public API responses.
- **TenantInterceptor** (`src/tenant/tenant.interceptor.ts`): Global interceptor, extracts tenantId from JWT or `X-Tenant-Id` header. **Registered inside `TenantModule`** (not AppModule) so it can inject `JwtService` + `ConfigService` from the JwtModule already imported there.
- **X-Tenant-Id cross-validation on @Public()**: when a Bearer token is supplied alongside `X-Tenant-Id`, the interceptor verifies the token (via `requireJwtSecret('JWT_SECRET', ...)`). If the header tenant ID differs from `payload.tenantId`, the request is rejected with `403 X-Tenant-Id does not match authenticated tenant`. `TenantContext.id` mirrors the same check as defense in depth for paths that bypass the interceptor (tests, sub-requests). Anonymous storefront requests (no token) keep working — the header is accepted on its own.
- **TenantGuard** (`src/auth/guards/tenant.guard.ts`): Validates tenant is ACTIVE.
- **ModuleGuard** (`src/auth/guards/module.guard.ts`): Checks `@RequiresModule()` decorator against TenantModule table. 5-min cache per tenant. Decodes JWT payload from `Authorization` header for `@Public()` endpoints (uses Base64 decode, no external dependency — advisory; the table lookup is the actual gate).
- **PlatformAdminGuard** (`src/auth/guards/platform-admin.guard.ts`): Restricts to platform admins.
- **AdminGuard** (`src/auth/guards/admin.guard.ts`): Restricts to tenant admins (`isAdmin`) OR platform admins. Apply via `@UseGuards(JwtAuthGuard, AdminGuard)` — keep `JwtAuthGuard` first so `request.user` is populated when AdminGuard runs. JwtAuthGuard short-circuits `@Public()` routes before AdminGuard, so adding it to a controller doesn't break public reads. **size-guides** was added to the wiring matrix on 2026-05-11 — its 9 admin routes (`/size-guides/admin`, `/deleted`, `:id`, POST, PATCH, set-default, toggle-active, restore, DELETE) were previously protected by `JwtAuthGuard` only (a customer JWT could mutate guides). The 3 public routes (`GET /size-guides`, `/default`, `/by-slug/:slug`) remain `@Public()`; `findBySlug` excludes drafts + soft-deleted via the WHERE clause (see size-guides.service.spec.ts).
- **@RequiresModule()** (`src/auth/decorators/requires-module.decorator.ts`): Decorator for optional module controllers.
- **TenantsModule** (`src/tenants/`): Full CRUD for tenants, subscriptions, billing, modules. Public resolve endpoint for storefront.
- All 26 services inject TenantContext and scope queries with `tenantId`.
- **IMPORTANT**: `@Public()` endpoints skip `JwtAuthGuard`, so `req.user` is never populated. Both `TenantContext` and `ModuleGuard` handle this by decoding the JWT from the Authorization header directly.
- Do NOT import from `@naro/shared` in API services (ESM/CJS mismatch). Define constants locally.

## Authentication
- Three-tier auth: `PlatformAdmin` (platform) → `AdminUser` (tenant staff) → `User` (customers)
- `validateUser()` checks User (with tenantId from header) then AdminUser (globally unique email)
- `validatePlatformAdmin()` checks PlatformAdmin table separately
- `generateTokens()` (async) includes `tenantId`, `isAdmin`, `isPlatformAdmin`, `role` in JWT payload. Returns `{ accessToken, refreshToken, accessExpiresIn, refreshExpiresIn }` so the controller can size cookie maxAge from the same source as the JWT `exp` claim (no drift).
- `JwtStrategy.validate()` checks: isPlatformAdmin → AdminUser (isAdmin) → User → AdminUser fallback
- Endpoints: `POST /auth/login`, `POST /auth/platform-login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`. `/auth/refresh` accepts refresh token from either `refresh_token` cookie OR JSON body field — admin SPA uses the body path (localStorage-based flow).
- Profile: `GET /auth/me` returns `enabledModules[]` for tenant admins
- Password reset: `POST /auth/forgot-password`, `POST /auth/reset-password`
- Account lockout: 5 failed attempts → lockedUntil = +30min; logged to LoginAttempt table
- **JWT secret resolution** (`src/auth/util/jwt-secrets.ts`): all 5 JWT sign/verify call sites (`auth.module`, `auth.service` ×3, `jwt.strategy`, `tenant.context`) use `requireJwtSecret('JWT_SECRET' | 'JWT_REFRESH_SECRET', config)`. In production: missing/short (<32 char) env var → throws at boot with actionable message (`Refusing to start: ... Generate one with: openssl rand -hex 48`). In dev: per-process random fallback with one-shot warning, so leaked dev tokens are never publicly known and invalidate on restart. Replaces the old `'naro-secret-key'`/`'naro-refresh-secret-key'` literal fallbacks. `ModuleGuard` keeps an unverified base64 decode (no secret needed) by design.
- **Customer ownership scoping** (`src/auth/util/ownership.ts`): `ownerScope(user)` returns `{ userId: user.id }` for non-admins, `{}` for admins. `isAdminUser(user)` is a boolean check. Used in customer-facing services to prevent IDOR — see Modules section for which services apply it.
- **Configurable session expiration**: `resolveTokenExpirations(tenantId?)` looks up SiteSetting keys `auth_access_token_expires` and `auth_refresh_token_expires` (per-tenant overrides) → falls back to env vars `JWT_ACCESS_EXPIRES` (default `15m`) and `JWT_REFRESH_EXPIRES` (default `7d`). 30-second in-memory cache keyed by tenantId. `parseDurationMs('15m'|'2h'|'7d'|'30s')` exported helper turns the same string into milliseconds for cookie `maxAge`. `cms.service.updateSetting()` enforces caps before saving (access: 30s–24h, refresh: 1m–90d) and rejects unparseable values with a `BadRequestException`. Admin UI: `/dashboard/settings` Security card has a "Session Timing" section with preset chips and a custom input.

## Modules (all fully implemented)
- **auth** - Login, register, JWT access/refresh tokens, profile, password change, 2FA toggle, forgot/reset password, account lockout
- **users** - Customer-facing: profile CRUD, addresses CRUD. Admin: `GET /users?search=` (list all tenant customers with order/rental counts, total spent), `PATCH /users/:id/suspend`, `PATCH /users/:id/activate`. **Address field shape**: schema uses `region` and `postalCode` (Tanzania-native). DTOs accept `state` and `zipCode` (American conventions used by storefront UI). The service maps `state→region`, `zipCode→postalCode` on input, and a private `serializeAddress()` helper emits BOTH shapes on output (`{ ...row, state: row.region, zipCode: row.postalCode ?? '' }`) so storefront and any future admin UI both read what they expect. `CreateAddressDto` requires `fullName` + `phone` (recipient info — used to display on saved address cards and ship-to labels); `zipCode` is optional. Don't reintroduce `phone: ''` or `fullName: dto.street` placeholders — those were a 2026-05 bug.
- **products** - Full CRUD with variants, images, search, filtering, toggle active, soft delete/restore, admin listing (includes inactive), purchasePrice/minimumStock/supplier fields, `GET /products/by-id/:id` for edit page. `POST /products/bulk-import` accepts a multipart CSV file (max 5MB, 500 rows) for batch product creation — resolves category by slug or name, returns `{ created, failed, total, errors[] }` with per-row validation feedback.
  - **Hierarchical category filter**: `GET /products` accepts `categoryId` OR `categorySlug`. Both resolve via the private `resolveCategoryIds()` helper which walks the category tree from the root and returns `[rootId, ...allDescendantIds]`, then filters with `where.categoryId = { in: ids }`. This is required because parent categories like "Men", "Wedding Dresses", "Accessories" have **zero direct products** — inventory lives in children (shirts, trousers, ball-gown, etc.). Without the fan-out, clicking a parent returns an empty list. Same helper is reused by `findAllAdmin`. When `categorySlug` doesn't resolve, the service short-circuits to `{ data: [], meta: { total: 0 } }` rather than falling through to "all products".
- **categories** - Nested category tree CRUD, soft delete/restore. `findAll()` returns 3 levels deep and includes `_count: { products: { where: { deletedAt: null } } }` at **every** nesting level (parent + children + grandchildren) — child categories would otherwise report 0 products in the admin tree. Soft-deleted products are excluded from the count. After the Prisma query, `findAll()` runs a second `product.findMany()` to collect the newest product-with-image per category (keyed by `categoryId`), then recursively attaches two computed fields to each node: `fallbackImageUrl` (first product image from the category or any descendant) and `totalProductCount` (direct + descendant rolled up). This lets storefront tiles show a real gown photo + rolled-up count for parents like "Wedding Dresses" whose inventory lives in subcategories.
- **cart** - Add/update/remove items, merge guest cart, count
- **wishlist** - Toggle, check, count. The `getWishlist` query includes each product's active variants (`id, name, stock, price`) so the storefront wishlist grid can Add-to-Cart without a second round-trip to `/products/:slug`. **Prisma include strict-typing pattern**: the reusable `wishlistItemInclude` object uses `orderBy: { createdAt: 'asc' as const }` + `satisfies Prisma.WishlistItemInclude`. Without `as const`, TypeScript infers `'asc'` as `string` (not `Prisma.SortOrder`), `pnpm build` fails, and — combined with `set -e` in `deploy.sh` — the CI deploy aborts BEFORE `pm2 restart`, silently leaving prod on stale code. Apply this pattern to any exported/shared Prisma include/select object that uses string literals for `orderBy` / `mode` / etc.
- **orders** - Create from cart, status workflow, admin listing, stats. `CreateOrderDto` accepts an optional `shippingFee?: number` (`@IsOptional() @IsNumber() @Min(0)`) and `OrdersService.create()` reads `const shippingCost = Number(dto.shippingFee ?? 0)` into `Order.total = subtotal + shippingCost`. Required because the storefront charges subtotal + delivery at checkout; if shipping is not persisted in `Order.total`, the subsequent `POST /payments/initiate` fails with `Payment amount (X) exceeds order total (Y)`. When adding a new order cost line (tax, surcharge, etc.), thread it through DTO → service → `Order.total` in the same commit or the gateway mismatch recurs.
- **payments** - Create, update status, webhooks, payment summary. Gateway dispatch is planned to move from a direct `SelcomProvider` call to a `PaymentProviderRegistry` keyed by `PaymentMethod.code`. Adding **ClickPesa / Mixx by YAS** alongside Selcom — new files: `payments/clickpesa.provider.ts` (JWT token cache per tenant with 55-min TTL + single-flight refresh, preview-ussd-push precheck, initiate-ussd-push, GET `/payments/{orderReference}` query, HMAC-SHA256 webhook checksum), `payments/clickpesa.checksum.ts` (canonical-JSON + HMAC helper — recursively sort keys, strip `checksum`/`checksumMethod`, hex-lowercase output), `payments/phone.util.ts` (shared `normalizePhone` + `isMixxMsisdn` for the 071/065/067/077 prefixes), `payments/payment-provider.registry.ts` (resolves a provider by code), `payments/payments.reconciliation.ts` (`@Cron(EVERY_30_SECONDS)` that polls `PROCESSING` payments and expires after `CLICKPESA_RECONCILE_CUTOFF_MINUTES`). Credentials are **per-tenant** — pull `clientId`/`apiKey`/`checksumSecret`/`usePreview` from `PaymentMethod.integrationParams` for code `CLICKPESA_MIXX` (no env vars). Planned public webhook route: `POST /payments/webhook/clickpesa/:tenantSlug` (ClickPesa cannot send `X-Tenant-Id`, so tenant is resolved from slug; `handleWebhook` needs to accept an explicit `tenantId` since `TenantContext` is request-scoped and unavailable on `@Public()` routes). Status mapping: ClickPesa `SUCCESS`/`SETTLED` → internal `COMPLETED`; `PROCESSING`/`PENDING` → `PROCESSING`; `FAILED` → `FAILED`. Full design: `C:\Users\rjurio\.claude\plans\groovy-painting-pudding.md`.
- **shipping** - Zones CRUD, rate calculation, shipment tracking
- **reviews** - Create, approve/reject, rating stats, product aggregation
- **rentals** - Booking, availability check, status workflow, upcoming pickups, pending returns, overdue tracking, admin update (wedding/shipping/transport details), transport receipt upload
- **rental-checklists** - Templates CRUD with activate/deactivate toggle, assign to rental (active-only), check/uncheck items per rental, soft delete/restore
- **rental-policies** - Global policy settings (buffer days, late fees, etc.)
- **flash-sales** - Time-limited sales CRUD with product pricing, soft delete/restore. Schema fields: `endDate` (not `endTime`), items via `FlashSaleItem` relation with `salePrice` + nested `product`
- **payment-methods** - DB-driven payment method CRUD (`PaymentMethod` model). 1 public endpoint (`GET /payment-methods` — active only), 7 admin endpoints (create, update, toggle-active, soft delete, restore, deleted list). Icon upload via `POST /upload/payment-icon` (2MB, JPEG/PNG/WebP/SVG → `uploads/payment-methods/`). Seeded: Visa, Mastercard, M-Pesa, Tigo Pesa, Airtel Money, Selcom Pesa, Halopesa.
- **referrals** - Referral code tracking and stats
- **id-verification** - National ID upload, admin approve/reject
- **cms** - Banners (soft delete/restore), pages (soft delete/restore), site settings CRUD. `GET /cms/settings/business-profile` returns all business profile fields including `mapLatitude`, `mapLongitude` (from SiteSetting key-value store). `GET /cms/storefront-stats` (public, tenant-scoped) returns `{ productCount, rentalCount, customerCount }` for live hero stats on the storefront homepage. **Parallax Sections CRUD**: 7 endpoints under `/cms/parallax-sections` (public list + admin CRUD + soft-delete + restore + toggle-active). Composite unique `(tenantId, sectionKey)` blocks duplicates with a friendly BadRequestException. Validates `sectionKey` against `PARALLAX_SECTION_KEYS` (HERO_AMBIENT, CATEGORIES, NEW_ARRIVALS, RENTAL, WEDDINGS, INSTAGRAM, FOOTER_BAND) and `effectType` against `PARALLAX_EFFECT_TYPES` (TRANSLATE_VERTICAL, TRANSLATE_HORIZONTAL, FIXED, ZOOM_ON_SCROLL, MIRROR, MOUSE_TILT, STATIC) — both exported from `cms.service.ts`
- **analytics** - Dashboard stats, revenue charts (daily/weekly/monthly). **Visitor analytics** added 2026-04-25 via `VisitorAnalyticsController` + `VisitorAnalyticsService` in the same module: public `POST /analytics/track` (no JWT, accepts `{ sessionId, path, referrer?, userId? }` body, reads `X-Tenant-Id` header, extracts IP from `x-forwarded-for`, derives country/city via `geoip-lite` package, parses UA via inline regex into deviceType/browser/os, drops bot traffic). Admin endpoints under `/analytics/visitors/*` (gated by `@RequiresModule('analytics')`): `overview` (page views + unique visitors + avg pages/session with prev-period comparison), `timeseries` (daily buckets via `$queryRaw date_trunc`), `top-pages` (`groupBy path`), `countries` (`groupBy country`), `devices` (parallel groupBy on deviceType + browser + os), `referrers`, `hourly` (DOW × HOUR heatmap via `$queryRaw EXTRACT`). All accept `?range=24h|7d|30d|90d` or `?from=&to=`. IP is never persisted — only derived country/city.
- **notifications** - Email + SMS sending
- **upload** - Local file upload. Endpoints: `POST /upload/image` → `uploads/products/` (5MB, JPEG/PNG/WebP), `POST /upload/payment-icon` → `uploads/payment-methods/` (2MB, JPEG/PNG/WebP/SVG), `POST /upload/category` → `uploads/categories/`, `POST /upload/hero-slide` → `uploads/hero-slides/`, `POST /upload/branding` → `uploads/branding/`, `POST /upload/banner` → `uploads/banners/`, `POST /upload/instagram-post` → `uploads/instagram-posts/`, `POST /upload/event` → `uploads/events/`, `POST /upload/document` → `uploads/documents/` (10MB, PDF + images), `POST /upload/3d-model` → `uploads/models/` (25MB, GLB/GLTF), `POST /upload/id-document` (legacy mock). ServeStaticModule serves all `/uploads` paths. **Defense-in-depth dimension cap**: `UploadService.uploadToFolder()` and `uploadImage()` run an `image-size` (pure-JS, ~30KB, no native binary) header probe and reject any raster image where width or height exceeds `MAX_DIMENSION = 4000` — protects against decompression-bomb files that pass the size check. SVG, ID documents, and 3D models bypass the dimension probe. Server is otherwise a passthrough writer — no `sharp`, no resize, no recompression (avoids binary-deps + OOM risk on the 2GB Vultr VPS). Client-side cropper produces canonical-size canvases before upload via the unified `IMAGE_PRESETS` registry in `@naro/shared`.
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
- **For admin endpoints, stack `@UseGuards(JwtAuthGuard, AdminGuard)`** — order matters (JwtAuthGuard must run first to populate `request.user`). Currently applied across: admin-users, products, orders (/admin, /stats), users (admin endpoints), categories (mutations), cms (all admin CRUD), payments (POST, PATCH /:id), payment-methods (admin), roles, permissions, expenses, inventory, reports, pos, rentals (admin endpoints + status updates).
- **For customer-mutable resources** (orders/payments/rentals shape) thread `@CurrentUser() user` through the controller and use `ownerScope(user)` from `src/auth/util/ownership.ts` in the Prisma `where`. Tenant-only scoping is an IDOR.
- RESTful endpoint naming under `/api/v1/`
- **All new services MUST inject TenantContext and scope queries with tenantId**
- **All new optional-module controllers MUST use `@RequiresModule('code')` + `ModuleGuard`**
- Do NOT import from `@naro/shared` in API services — ESM/CJS mismatch causes runtime crash
- Catch Prisma P2002 (unique constraint) → throw ConflictException (409)
- **DTO whitelist is strict**: the global `ValidationPipe` runs with `whitelist: true` + `forbidNonWhitelisted: true`. Any query/body field not declared on the DTO returns `400 property X should not exist`. When adding a new filter to an endpoint, the DTO must be updated in the same commit or clients silently 400 — the storefront's `.catch()` often masks this as "empty results".

## Tests (added 2026-05-10 with Phase 1 AI agent)
First test infrastructure in the repo. Plain Jest + ts-jest, no NestJS test harness needed for current coverage.
- Config: `jest.config.js` at api root. `rootDir: src`, `testRegex: .*\.spec\.ts$`, transform via ts-jest with `isolatedModules`.
- Run: `pnpm --filter api test` or `pnpm --filter api test:watch`.
- Current coverage: 4 spec files / 59 tests covering AI sanitiser, AI envelope helper, AI audit service (with mocked Prisma), and the read-only invariant on AI controllers.
- Conventions: spec files colocated with source (`foo.service.ts` ↔ `foo.service.spec.ts`). Mocked Prisma for service tests; no DB boot. Adding integration tests later will need a separate `naro_fashion_test` schema and a Nest-app boot helper.

## Database
- Connection string in `.env` and `packages/database/.env`
- Schema in `packages/database/prisma/schema.prisma`
- Generate client: `cd packages/database && pnpm prisma generate`
