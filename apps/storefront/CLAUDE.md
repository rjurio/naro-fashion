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
- `/` - Homepage (featured categories, new arrivals, flash sales, rental gowns). Hero stats (products/rentals/customers) fetched live from `GET /cms/storefront-stats` — each stat auto-hides when count is 0 (no placeholder numbers). Rental section perks come from `rental_section_features` CMS setting (newline-separated, admin-editable at `/dashboard/cms/settings`).
  - **Hero design**: Two-layer pattern — a zoomed/blurred `backdrop` (filter: blur(42px) brightness(0.55) saturate(1.25) + scale 1.15) fills the viewport so the hero never looks empty, and a **sharp `foreground` card at fixed `aspect-[3/4]`** (w-[260px]/300px/360px responsive) sits on top at natural proportions. Never stretch a portrait bridal photo across a wide hero with `object-cover` — use the blur-backdrop + framed-foreground split. Foreground card has rotating orbit rings, pulsing gold ring (`animate-hero-ring-pulse`), corner diamond accents, a title caption strip, and an inner diagonal light streak. Ken Burns zoom runs on the active slide only (`animate-hero-kenburns` gated by `index === currentSlide`). Hero slides come from `GET /cms/hero-slides`.
  - **Shop by Category**: Pulls `fallbackImageUrl` + `totalProductCount` from `GET /categories`. Image resolution is `imageUrl` → `fallbackImageUrl` → gradient placeholder with initial letter — never reference `/uploads/categories/<slug>.jpg` (those stock fallbacks were retired). Tiles sort by `totalProductCount` desc before `.slice(0, 4)` so stocked categories surface first, and item count uses `totalProductCount` so parents like Wedding Dresses display "14 items" instead of "0".
- `/products` - Product listing with filters (category, size, color, price, sort).
  - **Category filter is slug-based end-to-end**: state is `selectedCategorySlug`, the query sent to the API is `categorySlug=<slug>` (NOT `category=<name>` — display names 400 out on the DTO whitelist), and the page syncs state from `?category=<slug>` on mount so homepage tiles (which already link to `/products?category=${cat.slug}`) deep-link correctly.
  - **Sidebar flattens the nested category tree** returned by `GET /categories` (which is 3 levels deep) so that subcategories like "Shirts" / "Trousers" / "Ball Gown" are directly clickable, indented by depth, with the subtree product count (`totalProductCount`) in parentheses. Clicking a parent like "Men" returns all descendants via the API's hierarchical filter — don't re-implement the fan-out on the client.
- `/products/[slug]` - Product detail with gallery, reviews, add-to-cart, wishlist, optional 3D view (Photos/3D toggle when model3dUrl exists)
- `/categories` - Categories index grid
- `/categories/[slug]` - Category detail with filtered products
- `/cart` - Shopping cart with promo codes
- `/checkout` - Multi-step checkout (shipping, delivery, payment, confirm). The "Mobile Money" option stays a single choice in the UI; the API resolves which gateway actually runs the USSD push based on the tenant's active `PaymentMethod` rows. If the tenant has a `CLICKPESA_MIXX` PaymentMethod active, payments route to ClickPesa's Mixx-by-YAS flow (071/065/067/077 prefixes only); otherwise they fall through to Selcom. The frontend keeps posting `method: "MOBILE_MONEY"` + `phoneNumber` and polling `GET /payments/status/:transactionRef` — no storefront code change is needed to switch providers. Plan: `C:\Users\rjurio\.claude\plans\groovy-painting-pudding.md`.
- `/flash-sales` - Active flash sales with countdown
- `/rentals` - Browse rentable items
- `/rentals/[slug]` - Rental detail with date picker and booking
- `/shop` - Redirects to `/products`
- `/auth/login` - Login (with logo branding panel)
- `/auth/register` - Register (with logo branding panel)
- `/auth/forgot-password` - Password reset (with logo branding panel)
- `/orders/[id]` - Order confirmation / detail page. This is the redirect target from checkout (`/orders/:id?success=true`) — distinct from `/account/orders` (which is the history list). Shows success banner when `?success=true`, line items with resolved image URLs (via `API_ORIGIN` + `resolveImg()`), totals breakdown (subtotal, shipping, total), payment method (PaymentMethod enum value with underscores replaced), notes, "Not Found" fallback state, and "Browse Products" CTA. Fetches via `ordersApi.getOne(id)`.
- `/account` - Dashboard (orders, rentals, wishlist stats)
- `/account/orders` - Order history
- `/account/rentals` - Active and past rentals
- `/account/wishlist` - Saved items
- `/account/settings` - Profile settings
- `/account/id-verification` - National ID upload for rentals
- `/pages/[slug]` - CMS pages (about, contact, faq, terms, privacy, size-guide, shipping-info, returns-exchanges). Contact page includes embedded Google Map when valid coordinates are configured in Business Profile settings.
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
- **`www.` prefix stripped before domain lookup** (`hostname.replace(/^www\./i, '')`) so `www.narofashion.co.tz` and `narofashion.co.tz` both resolve to the same Tenant row (which is stored under the apex). Without this, `www` visitors fall through to the slug fallback and we waste a round-trip per request.
- Sets `tenantId` cookie (readable by client JS) + `X-Tenant-Id` response header
- API client reads `tenantId` from cookie and injects `X-Tenant-Id` header on all API requests
- If tenant is SUSPENDED, middleware returns 503. If not found, returns 404.
- **IMPORTANT**: Any raw `fetch()` calls to the API (outside the api client) MUST manually include the `X-Tenant-Id` header from `document.cookie`
- **CORS**: Production API must accept both apex and www origins. Set `STOREFRONT_URL="https://narofashion.co.tz,https://www.narofashion.co.tz"` in ALL three `.env` files (root, `apps/api/.env`, `packages/database/.env`) — Prisma's dotenv loads first and never overrides, so a stale value in `packages/database/.env` silently wins.

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
- `SiteSettingsContext` provides `settings.businessName` (and all business profile fields including `mapLatitude`, `mapLongitude`) from CMS API

## Parallax Effects
- **Tenant-toggleable parallax system** — sets `--parallax-y` on `:root` via a single global `requestAnimationFrame`-throttled scroll listener; multiple sections share that one variable, so adding more sections is free.
- **Master toggle**: `parallax_enabled` SiteSetting (`'true'/'false'`, default `'false'`). Configure at `/dashboard/cms/settings` → Features.
- **Per-section CRUD**: `/dashboard/cms/parallax-sections` (admin) → `GET /cms/parallax-sections` (public storefront). Each row has its own `effectType` (TRANSLATE_VERTICAL, TRANSLATE_HORIZONTAL, FIXED, ZOOM_ON_SCROLL, MIRROR, MOUSE_TILT, STATIC), scroll speed, overlay color/opacity, blur, sort order, active flag.
- **Default fallback**: When parallax is on but a section has no uploaded image, `parallax_default_fallback` SiteSetting picks the look — `BRAND_GRADIENT` (linear, default), `BRAND_RADIAL`, `BRAND_MESH`, or `NONE`. The fallback gradient pulls colors from CSS variables `--color-dark-500`, `--color-primary`, `--color-accent` so it adapts to per-tenant branding automatically.
- **Components** (in `apps/storefront/components/effects/`):
  - `<ParallaxSection sectionKey="...">` — wrapper that renders the appropriate backdrop (uploaded image OR fallback gradient OR nothing) behind its children. Resolves resolution order: parallax disabled / mobile / reduced-motion → no layer; uploaded config exists → image with effect; fallback != NONE → brand gradient; else nothing.
  - `<BrandGradientBackdrop style="BRAND_GRADIENT|BRAND_RADIAL|BRAND_MESH" />` — pure-CSS gradient using brand color variables.
  - `<RevealOnScroll>` — one-shot fade+slide-up on viewport entry via IntersectionObserver, gated by the same toggle. CSS in `globals.css` (`.reveal-on-scroll` / `.is-visible`).
- **Context**: `ParallaxProvider` in `contexts/ParallaxContext.tsx` mounted in `app/layout.tsx`. Self-contained — fetches its own settings + section configs, manages the global scroll listener lifecycle. Inactive (no listener attached, no CSS-var writes) when toggle is off OR `prefers-reduced-motion: reduce` OR viewport `< 640px`.
- **iOS Safari quirk**: `effectType: FIXED` is automatically coerced to `TRANSLATE_VERTICAL` at config-load time when iOS Safari is detected (UA-sniff once at mount) — `position: fixed` backgrounds bounce on iOS Safari and look broken.
- **Homepage sections wrapped**: CATEGORIES, NEW_ARRIVALS, RENTAL, WEDDINGS, INSTAGRAM, FOOTER_BAND. The HERO_AMBIENT key is reserved for the existing hero section — wiring there is intentionally deferred (the hero already has its own complex Ken Burns + orbit ring system; adding parallax there is a follow-up).

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- All user-facing strings must support i18n (English + Swahili) via `useTranslation()`
- Translation files: `messages/en.json` and `messages/sw.json` — 708 keys each, 100% parity (required). Whole storefront is fully internationalized (products, categories, cart, checkout, account, auth, header, footer, homepage, flash sales, rentals).
- **i18n interpolation**: The `t()` hook has no native placeholder support — use `t('key').replace('{placeholder}', value)` for dynamic values (e.g., price ranges, day counts, subscription labels).
- **Module-level arrays with translations**: Arrays of options (sortOptions, priceRanges, deliveryMethods, paymentMethods, steps, quickLinks) must live INSIDE the component (not at module scope) so `t()` can be called. Otherwise labels are stuck in the language at initial import.
- **Language switcher UX**: Header's single-button toggle shows the **target** language (shows "SW" when current is English, "EN" when current is Swahili) so the label tells the user what clicking will do. MobileMenu uses a two-button pattern where both are visible and the active one is highlighted.
- Brand colors: Black (#1A1A1A), Gold (#D4AF37)
- Tailwind v4: No tailwind.config.ts — theme defined via @theme in globals.css, utilities via @utility
- Mobile-first responsive design
- **Interactive hover/press states**: Global `cursor: pointer` on `a`, `button`, `select`, `[role="button"]`. Buttons have `active:scale-[0.97]` press feedback. Cards have `hover:shadow-xl`. Footer links have `hover:translate-x-1`. Social icons have `hover:scale-110`. Header icon buttons have `active:scale-95`.
- API product fields: use `basePrice` (not `price`), `compareAtPrice` (not `originalPrice`), `avgRating` (not `rating`), `images[0].url` (object, not string)
- Image URL resolution: define `API_ORIGIN = NEXT_PUBLIC_API_URL.replace('/api/v1', '')` and prefix `/uploads/...` paths before use in `<img>` src — use a `resolveImg()` helper
- **Native `<select>` option theming** (`app/globals.css`): browsers render the dropdown panel with OS defaults and only honor `background-color` + `color` on `<option>` elements — no border radius, no padding, no font override. A global rule (`select option, select optgroup { background-color: var(--color-card); color: var(--color-foreground); }`) themes all ~29 selects across the app at once. Don't inline-style each `<option>` and don't try to replace the native control with a custom listbox unless the design really demands it.
- **Header cart badge refresh pattern**: `Header.tsx` lives in the root layout and never unmounts across route changes, so `useEffect(…, [])` only fires once at app mount — adding an item to the cart from a product page leaves the badge stuck at its initial count. Fix: the cart-count effect depends on `[pathname]` AND subscribes to a `window.addEventListener('cart:updated', …)` custom event. `lib/api.ts` has a `notifyCartUpdated()` helper that every `cartApi` mutation (`addItem`, `updateItem`, `removeItem`, `clear`) calls after the successful API response. New code that mutates the cart through any path other than `cartApi` must dispatch `new CustomEvent('cart:updated')` itself, or the badge will go stale again.
- **Checkout → /orders/:id shippingFee**: the `ordersApi.create` call MUST include `shippingFee: shippingCost` in its payload or the order is persisted with `total = subtotal` (shipping fee silently dropped), and the payment gateway then rejects with `Payment amount (X) exceeds order total (Y)` when the storefront charges subtotal + delivery. The DTO on the API side accepts `shippingFee?: number` — threading it end-to-end is required.
