# Whole-Codebase Review — October 2026

An independent full-stack review (2026-10-04), run as five parallel review passes: API security, tenant isolation, money paths, frontends, and ops/architecture. Every critical or high finding was checked against the code before it was fixed. This is a follow-up to `docs/CODE_REVIEW_2026-07.md`. Several July "fixed" items turned out to be incomplete because a twin code path had been missed; those are marked **(July fix incomplete)**.

**Status:** everything below is fixed in the working tree. Nothing has been committed or deployed yet.

**Verification:**
- API `tsc --noEmit` is clean.
- API jest: **925/925 passing**, which includes about 15 new spec files.
- Storefront and admin `tsc --noEmit` are clean.
- Both Next.js apps compile, type-check and generate pages under `next build`. The only failure locally is the Windows standalone-trace symlink EPERM, which is environmental.
- `pnpm audit --prod`: **0 critical** (down from 5). High-severity advisories went from 88 to 26.

---

## Critical / High — fixed

| # | Finding | Fix |
|---|---|---|
| 1 | **Free paid orders.** When `SELCOM_*` was unset, Selcom simulated successful payments and its webhook skipped signature checks, with no production guard. The webhook lookup also ignored provider, so it could complete ClickPesa payments. The HMAC was computed over re-serialised JSON. | Fails closed in production. HMAC is now over the raw body. Lookup is scoped by `providerCode`. |
| 2 | `next@15.5.12` was affected by an image-optimizer RCE advisory. Critical advisories were also open in handlebars, liquidjs and jspdf. | next 15.5.27, plus dependency bumps and pnpm overrides. CI now fails a deploy on any critical advisory. |
| 3 | Rate limiting was configured but never applied. `trust proxy` was not set. | Global `AppThrottlerGuard` with per-route limits on sensitive endpoints. |
| 4 | `ProductVariant` rows were created with `tenantId = NULL`, which broke the tenant-scoped stock, checkout and POS paths for new products. | tenantId is set on every create. `scripts/backfill-variant-tenant.js` fixes existing rows. |
| 5 | Editing a product deleted and re-created every variant. That throws for sold products (FK Restrict) and silently emptied carts. | Variants are now upserted by id. Variants that existing orders reference are soft-disabled instead of deleted. |
| 6 | STAFF admins could change payment-gateway credentials and see secrets. They could also mark payments paid, refund, close periods, purge items and send newsletters. | `PermissionGuard` plus new permission codes, and secrets are masked in responses. |
| 7 | The ID upload was a mock, so the ID gate verified nothing. The reconciliation cron still wrote rental `CONFIRMED` **(July #23 incomplete)** and skipped the amount check **(July #13 incomplete)**. | Real private storage with an audited admin viewer. A single `PaymentSettlementService` is now shared by all settlement paths. |
| 8 | Instagram sync moved posts between tenants, and any tenant could control the global cron. | Sync is per tenant, with a per-tenant unique key. |
| 9 | `TenantGuard` was never registered, so suspended tenants kept API access. Suspended customers could still log in. | `TenantGuard` is now global. `isActive` is checked at login, refresh and JWT validation. |
| 10 | POS: exchanges could be replayed **(July #6 incomplete)**, refunds ignored discounts, the refund check raced, and the shift's expected cash used the amount tendered. | Atomic `refundedQuantity` claims, refunds valued at the net price, and net cash stored. |
| 11 | ai-assistant had no permission check, size limit or budget, so it could run up unlimited LLM spend. | `ai-agent:use`, DTO limits, a per-tenant daily cap and throttling. |
| 12 | Deploy: no tests in CI, no backup before db push, a parallel OOM-prone build, no health check, and backups kept on-box only. | CI verify gate, pre-deploy `pg_dump`, sequential build with manifest checks, health check, SHA assertion, and an off-site backup script. |

## Medium — fixed

### Auth
- Customer login ignored the tenant. Fixed: login, register and forgot-password are tenant-scoped.
- Prisma operator injection via the login body. Fixed: credentials are type-checked before any query.
- There was no token revocation. Fixed: `tokenVersion`, used for both the `tv` and `typ` JWT claims.
- Platform login had no lockout, and the admin lockout counter could race. Both fixed.
- No password policy was enforced. Fixed.
- 2FA looked enabled but did nothing. Enabling it is now blocked until real TOTP exists.
- Privilege escalation through `role: 'SUPER_ADMIN'`, cross-tenant `roleId`, and edits to system roles. All closed.
- Login responses leaked `twoFASecret` and the reset-token hash. Fixed.

### Tenant links
- Cross-tenant foreign ids could be set for category parent, size guide, POS customer, flash-sale products, shipping zone, cart, wishlist and events. Fixed with `assertSameTenant`.
- Public events exposed user ids. Fixed.
- Emails used an arbitrary tenant's branding **(July #15 incomplete)**. Fixed.
- The webhook dedup key and `Payment.transactionRef` were globally unique. Both are now per-tenant.

### Payments and orders
- A webhook could downgrade a COMPLETED payment. Fixed.
- A cancelled or paid order could be paid again. Fixed.
- No cumulative payment cap. Added.
- The duplicate-payment guard was check-then-insert **(July #25 incomplete)**. Now serialised with an advisory lock.
- Order creation and cancel had races. Fixed with a single transaction under an advisory lock plus a conditional cancel.
- Inactive products could be ordered, and the cart's productId could be spoofed. Both fixed.
- Shipping fee was trusted from the client. Now computed on the server.
- Promo codes and flash-sale prices were never applied. Both now applied server-side.
- Customers could cancel paid orders. Now blocked; an admin cancel sets `REFUND_PENDING`.
- Unpaid orders and rentals held stock forever. Now handled by expiry crons and a cap on open COD orders.

### Rentals
- Late fees used the wrong base. Now counted from the booked return date.
- Admin date edits skipped the availability check. Fixed.
- Status could skip steps. Now forward-only.
- Subscription renewal from GRACE or TRIAL failed, and month arithmetic overflowed. Both fixed.

### Reports
- Revenue dropped partially refunded and closed sales and rentals. Fixed.
- Dates used UTC instead of EAT. Fixed.
- Closed financial periods could still be edited. Fixed.

### Frontend
- The open-redirect fix could be bypassed **(July #16 incomplete)**. Fixed.
- No CSP or security headers. Added to both apps.
- The tenant wasn't forwarded to SSR, unknown hosts served the default store, and the tenant cache was unbounded. All fixed.
- The image optimizer acted as an open proxy. Fixed.
- No token refresh on the storefront, and "Remember me" broken on admin reload. Both fixed.
- Uploads bypassed token refresh, and logout didn't revoke. Both fixed.
- Admin lists were capped at 20 rows. Server-side pagination added.
- Sitemap, footer and events requests were missing the tenant header. Fixed.
- No per-page SEO metadata. Added.
- No render-side sanitization. Added.
- i18n, `lang`, contrast and dialog accessibility gaps. Fixed.

### Platform
- Swagger was public in production. Now disabled there.
- No `/health` endpoint. Added.
- PageView had no retention. Added a retention cron.
- 3D model upload accepted any file type. Fixed.
- Audit CSV was open to formula injection. Fixed.

### PDPA
- Added customer data export and account deletion (anonymise) endpoints.
- ID documents are private and access-audited.

### Pre-existing bugs found and fixed along the way
- Admin category create/edit was always rejected with a 400.
- Admin review rejection always returned 403.
- The admin dashboard's recent orders always failed with a 400.
- Admin order status updates always failed (title-case values).
- The storefront category page and related products were always empty (wrong query param).
- ClickPesa webhooks never matched the denormalised ref (greedy regex).
- The storefront ID upload posted to a route that didn't exist.

---

## Operator actions required before or at deploy

1. **Local and prod DB schema:** `db push` must accept the new composite unique constraints. deploy.sh does this after taking a pre-deploy dump. For local dev, run `pnpm prisma db push --accept-data-loss` from `packages/database`.
2. Run `node scripts/backfill-variant-tenant.js --dry-run`, then run it without the flag, on the VPS right after deploy.
3. Check that `JWT_SECRET` and `JWT_REFRESH_SECRET` differ in all three `.env` files. Production now refuses to boot otherwise.
4. Check `SELCOM_API_KEY/SECRET/VENDOR` on the VPS. If they're unset, card/Selcom payments now return 503 instead of being simulated. Use ClickPesa or configure Selcom.
5. Set `STOREFRONT_DEFAULT_HOSTS=narofashion.co.tz,www.narofashion.co.tz` in the storefront env. Make sure `NEXT_PUBLIC_API_URL` is set at build time, because the CSP reads it.
6. Grant the new permissions to non-SUPER_ADMIN roles as needed. MANAGER gets its defaults automatically. STAFF lose access to reports, refunds and exchanges, payment settings and AI unless granted.
7. Change the platform admin password if it is still the documented default. Rotate any credentials published in CLAUDE.md.
8. Set up backups and monitoring per `docs/OPS/BACKUPS.md` and `docs/OPS/MONITORING.md`: bucket, rclone, age key, cron, Healthchecks, UptimeRobot, Sentry. Then run and record a restore test.

## Deferred (strategic)
- Committed Prisma migrations with `migrate deploy`, instead of `db push --accept-data-loss`.
- A Prisma client extension that auto-injects tenantId, plus a shape-spec for tenant scoping. Composite same-tenant FKs, and making `tenantId` required.
- Release-directory deploys or CI-built artifacts, for real zero-downtime and rollback.
- Nonce-based CSP in place of `'unsafe-inline'`.
- A real TOTP 2FA flow.
- Refund execution through the gateway for `REFUND_PENDING` orders.
- A flash-sale per-item stock limit (needs a schema column).
- Remaining high-severity advisories are transitive: mailer/mjml, Prisma CLI internals and build tooling. Review on the next dependency pass.
- Freeze AI subsystem scope (about 38% of API code). Add Playwright smoke tests and tests for the payment webhook happy path against the provider sandboxes.
- PDPA: a privacy-notice page per tenant (the footer link exists), retention schedule for ID documents, and documentation of cross-border hosting.
