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

## Image Upload Presets
- `IMAGE_PRESETS` (`src/image-presets.ts`) — single source-of-truth registry for every image-upload context. Keys: `product`, `heroSlide`, `category`, `eventCover`, `eventGallery`, `instagramPost`, `banner`, `logoSquare`, `favicon`, `logoWide`, `paymentIcon`, `newsletterInline`, `idDocument`. Each preset declares: `aspectRatio`, `outputWidth`/`outputHeight`, `outputMime`, `quality`, `minSourceWidth`/`minSourceHeight`, `maxFileSizeMB`, `allowedMimes`, `skipCrop`, `uploadEndpoint`. Output dimensions are derived from the largest CSS render box at 2× DPR per storefront context. Helpers: `getImagePreset(key)`, `formatAllowedMimesForToast(preset)`.
- All admin uploaders consume presets via `<PresetImageUploadField presetKey="..." />` (`apps/admin/components/ui/PresetImageUploadField.tsx`); the storefront ID-verification page imports `idDocument` for client-side mime/size validation strings only (no crop or recompress — evidence integrity).
- The parameterized `ImageCropModal` (`apps/admin/components/products/ImageCropModal.tsx`) accepts an optional `preset` prop. Defaults match the legacy product flow (3:4 / 900×1200 / JPEG q 0.80) so passing nothing is regression-safe.

## Conventions
- All cross-app types and enums live here — never duplicate in individual apps
- Keep exports organized by domain (products, rentals, orders, etc.)
- **IMPORTANT**: Do NOT import from `@naro/shared` in NestJS API services — causes ESM/CJS runtime crash. Only import in Next.js apps (storefront, admin). The API duplicates the small `MAX_DIMENSION = 4000` constant locally in `apps/api/src/upload/upload.service.ts` instead of importing the registry.
