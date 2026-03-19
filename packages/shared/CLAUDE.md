# Shared Package

Shared TypeScript types, enums, and constants used across storefront and admin apps.

## Multi-Tenant Exports
- `PlatformRole` — PLATFORM_ADMIN, PLATFORM_SUPPORT
- `TenantStatus` — ACTIVE, TRIAL, SUSPENDED, DEACTIVATED
- `SubscriptionStatus` — ACTIVE, EXPIRED, CANCELLED, GRACE
- `BillingCycle` — MONTHLY, YEARLY
- `TenantPaymentMethod` — MOBILE_MONEY, BANK_TRANSFER, MANUAL
- `TenantPaymentStatus` — PENDING, COMPLETED, FAILED
- `PLATFORM_MODULES` — All module codes with name/description (24 modules)
- `CORE_MODULES` — Module codes that cannot be disabled (9 core modules)
- `ModuleCode` — Type for module code keys

## Conventions
- All cross-app types and enums live here — never duplicate in individual apps
- Keep exports organized by domain (products, rentals, orders, etc.)
- **IMPORTANT**: Do NOT import from `@naro/shared` in NestJS API services — causes ESM/CJS runtime crash. Only import in Next.js apps (storefront, admin).
