# Whole-Codebase Review — July 2026

Full-stack review of the Naro Fashion monorepo (NestJS API + storefront + admin + shared/DB), run across seven parallel review agents (API security, API correctness, tenant-isolation, money-paths, storefront, admin, schema/config). This document is the findings register: what was found, what was fixed this session, and what is deferred with a recommended next step.

**Fix commits (all deployed to prod and verified):**
- `c6b2b38` — gitignore + remove leaked root credential dumps
- `5523717` — service-layer tenant scoping + POS/payment money bugs
- `bd81d04` — rich-text sanitization + storefront XSS hardening
- `61bf158` — **RBAC enforcement** (PermissionGuard) on admin-user/role/audit endpoints (follow-up round)
- `623853c` — per-tenant rental cron recipients + inventory-adjust stock fix (follow-up round)

**Structural takeaway:** `admin-guard-coverage.shape.spec.ts` proves every route has the right *guard*, but nothing proved each service actually *filters Prisma queries by tenantId*. Most HIGH findings lived in that blind spot. New guard added: `pos-tenant-scope.shape.spec.ts`. A general "tenantId present in find/update/delete where-clauses" invariant is the recommended next structural investment.

---

## FIXED this session

| # | Severity | Finding | Fix | Where |
|---|---|---|---|---|
| 1 | Operational-CRITICAL | Live admin JWT + admin PII in ~12 untracked root `*.json`, not gitignored — one `git add -A` from public exposure | Ignore all root `*.json` except the 3 real config files; deleted the dumps. Never committed, so nothing leaked publicly | `.gitignore` |
| 2 | HIGH | POS resolved `ProductVariant` by id/barcode with no tenant filter → cross-tenant stock tampering + product read | Every POS variant lookup now filters `tenantId` (lookupBarcode, updateBarcode, createSale, completeLayaway, createExchange) | `pos.service.ts` |
| 3 | HIGH | Public `GET /payment-methods` returned `integrationParams`/`integrationKey` (gateway secrets) to anyone | Public read now select-whitelists display fields only | `payment-methods.service.ts` |
| 4 | HIGH | payment-methods admin mutations (update/toggle/softDelete/restore) not tenant-scoped → cross-tenant IDOR on gateway config | `findOneOrFail` + `restore` now filter `tenantId` | `payment-methods.service.ts` |
| 5 | HIGH | `roles.addPermissions` had no tenant/isSystem guard → grant perms to shared SUPER_ADMIN system role → platform-wide escalation. `restore`/`getRolePermissions` also unscoped | Resolve role via tenant-or-system guard + block isSystem mutation; `restore` tenant-scoped | `roles.service.ts` |
| 6 | HIGH | POS partial refund replayable unlimited times (unbounded cash-out + phantom restock) | New `OrderItem.refundedQuantity` tracks cumulative refunds per line; partial refunds guard against remaining qty; total-cash cap | `pos.service.ts`, `schema.prisma` |
| 7 | HIGH | POS stock written as absolute value from stale pre-tx read → concurrent-sale oversell | Atomic guarded `updateMany({ stock: { gte } }, { decrement })` in sale/layaway/exchange | `pos.service.ts` |
| 8 | HIGH | Reconciliation cron force-failed payments on age BEFORE any gateway check → slow Mobile-Money PIN entry lost the payment | Gateway status checked first; age-fail only when gateway hasn't confirmed | `payments.reconciliation.ts` |
| 9 | HIGH | Product JSON-LD injected via `JSON.stringify` without escaping → `</script>` breakout XSS | Escape `< > &` to `\uXXXX` in the ld+json output | storefront `products/[slug]/page.tsx` |
| 10 | HIGH | API stored admin rich-text HTML verbatim; storefront+admin render it via `dangerouslySetInnerHTML` → stored XSS | `sanitizeRichText()` (xss allowlist) applied on write to CMS page content, size-guide content, newsletter body | `common/sanitize-html.util.ts` + 3 services |
| 11 | MEDIUM | admin-users `assignRole`/`removeRole` didn't verify target admin's tenant | Load target with `{ id, tenantId }`, 404 on mismatch | `admin-users.service.ts` |
| 12 | MEDIUM | rental-checklists `checkItem`/`uncheckItem` mutated entries by id, no parent-tenant check | Scope via parent `RentalOrder.tenantId` relation filter | `rental-checklists.service.ts` |
| 13 | MEDIUM | Webhook credited COMPLETED without verifying collected amount vs expected | Amount-short webhooks held as PROCESSING for review, not completed | `payments.service.ts` |
| 14 | MEDIUM | ClickPesa webhook wrote dedup row before checksum → junk webhook could pre-empt the real one | Reject invalid checksum before writing the idempotency row | `payments.service.ts` |
| 15 | MEDIUM | notifications branding (`getBusinessName`/`getDomain`) unscoped → cross-tenant branding in cron sends | Helpers accept tenantId; rental-reminder crons pass `rental.tenantId` | `notifications.service.ts`, `scheduler.service.ts` |
| 16 | MEDIUM | Storefront login `?redirect=` unvalidated → post-login open-redirect phishing | Accept same-origin relative paths only | storefront `auth/login/page.tsx` |

Regression guards added: `pos-tenant-scope.shape.spec.ts`, `sanitize-html.util.spec.ts`, plus new admin-users cross-tenant tests. Full API suite: 591 passing (the 1 failure is the pre-existing, unrelated, documented stale sidebar-label spec).

### FIXED — follow-up round (`61bf158`, `623853c`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 17 | HIGH | RBAC seeded but NOT enforced on non-AI admin routes → any STAFF/MANAGER admin could `POST /admin-users` with `role:'SUPER_ADMIN'` (escalation) | New `PermissionGuard` + `@RequiresPermission()` (SUPER_ADMIN/platform-admin bypass, effective-permission resolution cached) wired onto admin-users (admins:*), roles (roles:manage/view), audit (audit:view/export). 8-case guard spec. |
| 18 | MEDIUM | Rental prep/overdue crons resolved a GLOBAL SUPER_ADMIN recipient → cross-tenant admin notifications | `getAdminContact(tenantId)` scopes to the rental's tenant; recipient resolved per-tenant (cached) in both crons |
| 19 | MEDIUM | Prep-reminder cron had no lower date bound → overdue rentals spam daily with negative day counts | Added `pickupDate: { gte: now }` |
| 20 | MEDIUM | `inventory.adjustStock` product-level path wrote a ledger row but never changed stock (ledger diverged) | Resolve unambiguous target: apply to sole variant for single-variant products, reject multi-variant with "specify variantId" |

---

## DEFERRED — recommended, needs a decision or larger change

These are real but were left out of this session's fixes because they need a product decision, a schema/migration strategy, or infra changes that shouldn't be made unilaterally.

**Payments / money**
- **Selcom webhook HMAC** is computed over Nest's re-serialized body (not raw bytes) and returns `true` when creds are unset (fail-open). Fix needs raw-body capture in `main.ts` + fail-closed — test carefully so the live Selcom flow doesn't break.
- **Promo codes are cosmetic**: `orders.create` hardcodes `discount = 0` and `recordUsage()` has zero callers, so `maxUses`/`maxUsesPerUser` never trigger. Needs `promoCodeId` threaded through the order DTO + `recordUsage` wired in the order transaction. (Feature work.)
- **Flash-sale prices are display-only** — never applied to the charged total. Needs effective-price resolution when building order line items.
- **Online orders never check or decrement stock** (unlimited web oversell). May be intentional (manual fulfillment) — needs a product decision; if not, add a stock check at checkout + atomic decrement on payment.
- **Customer can cancel a PAID order** with no refund path (paymentStatus flips but Payment rows stay COMPLETED). Needs a refund workflow decision.
- **Payment amount validated per-call, not cumulatively**; no guard against a duplicate PENDING payment on the same order.

**Rentals**
- **Double-booking race**: availability `count` and `create` aren't atomic. Needs a Postgres exclusion constraint on (product, date-range) or an advisory lock.
- **Orphan `CONFIRMED` status** (payment path sets a status not in the workflow array) breaks the forward-only guard and can bypass mandatory ID verification. Needs status-vocabulary unification (product decision).

**Inventory / subscriptions**
- Subscription downgrade doesn't disable modules dropped by the new plan → tenant keeps paid features free.

**Admin RBAC** — *(FIXED `61bf158`: PermissionGuard now enforces per-action permissions on admin-users/roles/audit; STAFF/MANAGER can no longer create/promote admins. The frontend still shows these nav items to all roles — a UX polish, not a security gap, since the API now 403s.)*

**Frontend defense-in-depth**
- Access + refresh tokens in `localStorage` (both apps) → XSS yields persistent takeover. Consider httpOnly cookies for the refresh token.
- No CSP / security headers in either `next.config.js` — verify nginx sets them; otherwise add a `headers()` block.
- Storefront `sitemap.ts` + a few raw client `fetch()` calls (Footer payment methods, homepage events, contact POST) omit `X-Tenant-Id` → break/cache-poison under multi-tenant. Route through the api client.
- Render-side rich-text sanitization (storefront/admin) as belt-and-suspenders on top of the new API write-side sanitization.
- Client-trusted shipping fee at checkout (LOW).

**Schema / deploy**
- `deploy.sh` runs `prisma db push --accept-data-loss` on every deploy with `prisma/migrations/` gitignored and no pre-backup → a future field rename silently drops data. Move to `migrate deploy` + committed migrations, or at minimum `pg_dump` before push and drop the flag.
- No `Tenant` FK on ~46 of 52 tenant-scoped models (integrity + orphan-on-delete); `User.googleId`/`facebookId` globally unique instead of per-tenant; `RentalPolicy` lacks `@@unique([tenantId])`. Tie to the "make tenantId required" migration.
- 2GB-OOM sequential-build hardening in `deploy.sh` still an unimplemented TODO.

---

## ACCEPTED / documented (no action)
- Money is uniformly `Decimal(12,2)` — clean.
- DB dev password + default creds in CLAUDE.md are documented dev conventions.
- `eslint.ignoreDuringBuilds: true` on both apps — accepted (TS errors still block builds).
- Newsletter `unsubscribe` by globally-unique token is intentional.
