# Storefront App

Customer-facing Next.js PWA for Naro Fashion. Runs on port 3000.

## Stack
- Next.js 15+ (App Router), React 19, TypeScript, Tailwind CSS v4
- next-themes (Light/Dark/Standard themes via CSS variables)
- custom I18nProvider (English + Swahili)

## Theming
- ThemeProvider: `attribute="data-theme"`, themes: `light | dark | standard`, `enableSystem={false}`
- **First-visit auto-detection**: Inline `<script>` in `app/layout.tsx` runs before React hydrates — reads `prefers-color-scheme`, sets `localStorage('theme')` and `data-theme` attribute on `<html>` (dark→`dark`, else→`standard`)
- **Returning visitors**: next-themes reads `localStorage('theme')` — user's manual choice is preserved
- Theme toggle (`components/ui/ThemeToggle.tsx`) cycles: light → dark → standard

## Pages
- `/` - Homepage (featured categories, new arrivals, flash sales, rental gowns)
- `/products` - Product listing with filters (category, size, color, price, sort)
- `/products/[slug]` - Product detail with gallery, reviews, add-to-cart, wishlist, optional 3D view (Photos/3D toggle when model3dUrl exists)
- `/categories` - Categories index grid
- `/categories/[slug]` - Category detail with filtered products
- `/cart` - Shopping cart with promo codes
- `/checkout` - Multi-step checkout (shipping, delivery, payment, confirm)
- `/flash-sales` - Active flash sales with countdown
- `/rentals` - Browse rentable items
- `/rentals/[slug]` - Rental detail with date picker and booking
- `/shop` - Redirects to `/products`
- `/auth/login` - Login (with logo branding panel)
- `/auth/register` - Register (with logo branding panel)
- `/auth/forgot-password` - Password reset (with logo branding panel)
- `/account` - Dashboard (orders, rentals, wishlist stats)
- `/account/orders` - Order history
- `/account/rentals` - Active and past rentals
- `/account/wishlist` - Saved items
- `/account/settings` - Profile settings
- `/account/id-verification` - National ID upload for rentals
- `/pages/[slug]` - CMS pages (about, contact, faq, terms, privacy, size-guide, shipping-info, returns-exchanges)
- `/unsubscribe` - Token-based newsletter unsubscribe page

## Instagram Feed
- `components/social/InstagramFeed.tsx` fetches from API, shows real IG posts with likes/captions on hover
- Visibility controlled by `instagram_feed_visible` site setting (fetched in homepage)
- Posts ordered: API-fetched (newest) → Pinned → Manual

## Newsletter
- Homepage + Footer subscribe forms wired to `POST /newsletter/subscribe`
- `newsletterApi` in `lib/api.ts` handles subscription
- Unsubscribe page at `/unsubscribe?token=xxx`

## Multi-Tenancy
- `middleware.ts` resolves tenant by custom domain (or `NEXT_PUBLIC_TENANT_SLUG` env var for local dev)
- Middleware calls `GET /api/v1/tenants/resolve?domain=...` (or `?slug=...`), caches result 60s
- Sets `tenantId` cookie (readable by client JS) + `X-Tenant-Id` response header
- API client reads `tenantId` from cookie and injects `X-Tenant-Id` header on all API requests
- If tenant is SUSPENDED, middleware returns 503. If not found, returns 404.
- **IMPORTANT**: Any raw `fetch()` calls to the API (outside the api client) MUST manually include the `X-Tenant-Id` header from `document.cookie`

## Data Flow
- All pages fetch from NestJS API at `http://localhost:4000/api/v1`
- API client in `lib/api.ts` with domain functions: productsApi, categoriesApi, cartApi, wishlistApi, ordersApi, rentalsApi, reviewsApi, flashSalesApi, cmsApi, authApi, idVerificationApi, shippingApi, newsletterApi
- Auth token from `localStorage('token')` + tenantId from cookie — both auto-injected as headers
- `.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`
- `.env.local` contains `NEXT_PUBLIC_TENANT_SLUG=naro-fashion` (local dev fallback for tenant resolution)

## Assets
- `public/logo.jpg` - Full Naro Fashion logo (auth page branding panels)
- `public/icon.jpg` - Circular icon (header, footer, mobile menu, mobile auth)
- `public/favicon.jpg` - Browser tab icon

## Footer
- Copyright line renders dynamically: `© {new Date().getFullYear()} {settings.businessName}. All rights reserved.` — never hardcoded
- Phone (`tel:`) and email (`mailto:`) links open native dialer/email app
- Payment methods section fetches active methods from `GET /payment-methods` — shows uploaded icon image or text pill fallback
- `SiteSettingsContext` provides `settings.businessName` (and all business profile fields) from CMS API

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- All user-facing strings must support i18n (English + Swahili) via `useTranslation()`
- Translation files: `messages/en.json` and `messages/sw.json`
- Brand colors: Black (#1A1A1A), Gold (#D4AF37)
- Tailwind v4: No tailwind.config.ts — theme defined via @theme in globals.css, utilities via @utility
- Mobile-first responsive design
- API product fields: use `basePrice` (not `price`), `compareAtPrice` (not `originalPrice`), `avgRating` (not `rating`), `images[0].url` (object, not string)
- Image URL resolution: define `API_ORIGIN = NEXT_PUBLIC_API_URL.replace('/api/v1', '')` and prefix `/uploads/...` paths before use in `<img>` src — use a `resolveImg()` helper
