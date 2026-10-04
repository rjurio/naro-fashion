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
- **Layout knobs** (admin-configurable in `/dashboard/cms/settings` Features group):
  - `instagram_feed_layout` (`single_row` | `multi_row`, default `single_row`)
  - `instagram_feed_rows` (2/3/4/5, default `2`) — only used for `multi_row`
  - `instagram_feed_max_posts` (6/12/18/24/30, default `30`) — hard upper cap
- Effective visible count = `min(max_posts, layout === 'single_row' ? 6 : rows × 6)`. The constant `DESKTOP_COLS = 6` in `InstagramFeed.tsx` MUST stay in sync with the `lg:grid-cols-6` Tailwind class on the grid — change one, change the other.
- Homepage parses all three settings and passes them as `maxPosts` / `layout` / `rows` props. When the resulting slice is empty, the whole section hides.
- Posts ordered: API-fetched (newest) → Pinned → Manual

## Newsletter
- Homepage + Footer subscribe forms wired to `POST /newsletter/subscribe`
- `newsletterApi` in `lib/api.ts` handles subscription
- Unsubscribe page at `/unsubscribe?token=xxx`

## Multi-Tenancy
- `middleware.ts` resolves tenant by custom domain (or `NEXT_PUBLIC_TENANT_SLUG` env var for local dev)
- Middleware calls `GET /api/v1/tenants/resolve?domain=<encodeURIComponent>` (or `?slug=...`). Results live in a **bounded LRU** (500 hosts, 60s TTL; misses negative-cached 10s).
- **Unknown Host → 404 in production.** The `NEXT_PUBLIC_TENANT_SLUG` fallback is used ONLY for `localhost`/`127.0.0.1` when `NODE_ENV !== 'production'`, or for hosts listed in `STOREFRONT_DEFAULT_HOSTS` (comma list, e.g. `narofashion.co.tz,www.narofashion.co.tz`). narofashion.co.tz normally resolves via the domain lookup (apex stored on the Tenant row, `www.` stripped); set `STOREFRONT_DEFAULT_HOSTS` on the VPS as a safety net. A random domain pointed at the VPS no longer silently serves the default tenant.
- **Tenant is forwarded on the REQUEST** (`NextResponse.next({ request: { headers } })` with `x-tenant-id`), always overwriting any client-sent value (and stripping it on skipped paths). Server code reads it via `getServerTenantId()` / `serverTenantHeaders()` / `serverApiGet()` in `lib/tenant-server.ts` — header first, `tenantId` cookie second — so first-visit SSR, crawlers, manifest, sitemap and generateMetadata get the right tenant.
- **`www.` prefix stripped before domain lookup** (`hostname.replace(/^www\./i, '')`) so `www.narofashion.co.tz` and `narofashion.co.tz` both resolve to the same Tenant row (which is stored under the apex). Without this, `www` visitors fall through to the slug fallback and we waste a round-trip per request.
- Sets `tenantId` cookie (readable by client JS, `sameSite=lax`, `secure` in prod) + `X-Tenant-Id` response header
- API client reads `tenantId` from cookie and injects `X-Tenant-Id` header on all API requests
- If tenant is SUSPENDED, middleware returns 503. If not found, returns 404.
- **IMPORTANT**: Don't write raw `fetch()` calls to the API — use `api.get/post` from `lib/api.ts` (injects Bearer + X-Tenant-Id, refresh-on-401). Multipart goes through `uploadMultipart`/`uploadApi`; for anything else raw use `clientAuthHeaders()`. (Footer payment-methods/pages, homepage events and the contact POST were converted in Oct 2026.)
- **SSR fetches must inject the tenant header explicitly**: server components don't auto-forward cookies, so any `fetch` from a server component or `manifest.ts`/`robots.ts`/etc. must read the `tenantId` cookie via `cookies()` from `next/headers` (async in Next 15) and pass `X-Tenant-Id` in the request headers — use `serverTenantHeaders()` / `serverApiGet()` from `lib/tenant-server.ts`. Use `cache: 'no-store'` for tenant-scoped SSR fetches because Next's URL-keyed cache would otherwise return tenant A's payload to tenant B's first request after revalidation. Without this, every tenant gets the default branding/PWA name on first paint.
- **The API rejects mismatched JWT vs X-Tenant-Id with 403**: if a customer's JWT carries tenant A but the request includes `X-Tenant-Id: B`, the API responds `403 X-Tenant-Id does not match authenticated tenant`. Drift is bounded to one request because middleware overwrites the cookie every time, but if you're seeing 403s on legitimate flows, check that the cookie hasn't gone stale.
- **CORS**: Production API must accept both apex and www origins. Set `STOREFRONT_URL="https://narofashion.co.tz,https://www.narofashion.co.tz"` in ALL three `.env` files (root, `apps/api/.env`, `packages/database/.env`) — Prisma's dotenv loads first and never overrides, so a stale value in `packages/database/.env` silently wins.

## Data Flow
- All pages fetch from NestJS API at `http://localhost:4000/api/v1`
- API client in `lib/api.ts` with domain functions: productsApi, categoriesApi, cartApi, wishlistApi, ordersApi, rentalsApi, reviewsApi, flashSalesApi, cmsApi, authApi, idVerificationApi, shippingApi, newsletterApi
- **Auth tokens** live in `tokenStore` (`lib/api.ts`): access + refresh token in the SAME storage — `localStorage` when "Remember me" is checked on login, else `sessionStorage`. Never read `localStorage.token` directly. On 401 the client does ONE shared in-flight `POST /auth/refresh {refreshToken}` and replays once; a 4xx refresh purges tokens + fires `auth:expired`, a network/5xx refresh keeps them (throws 503). `logout()` calls `POST /auth/logout {refreshToken}` (revokes the token version) then clears both storages. `change-password` returns fresh tokens that MUST be stored (`tokenStore.set`).
- Password policy (client mirror in `lib/password.ts`): 8–128 chars with at least one letter and one digit.
- Account settings has **Download my data** (`GET /users/me/export` → JSON file) and **Delete my account** (dialog, `DELETE /users/me {currentPassword}`; API message shown on 400).
- **ID verification** uploads each side to `POST /upload/id-document?side=front|back` (jpg/png/webp/pdf, 8MB, validated client-side) and submits the returned `private://id-documents/...` refs. Never render those refs as `<img>` — previews come from the local File.
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

## Visitor Analytics (added 2026-04-25)
- `<AnalyticsTracker>` (`components/analytics/AnalyticsTracker.tsx`) mounted inside the `<Suspense>` boundary in `app/layout.tsx` — fires a `POST /analytics/track` beacon on every route change via `usePathname()` + `useSearchParams()`.
- Session ID stored in a `naro_sid` cookie (30-min sliding window). Generated client-side via `crypto.randomUUID()`. Cookie also acts as the unique-visitor key on the dashboard.
- Tenant ID is read from the existing `tenantId` cookie (set by `middleware.ts` during tenant resolution) and injected as `X-Tenant-Id` header on the track call.
- `fetch(..., { keepalive: true })` is used so navigation doesn't drop in-flight beacons; failures are silent (tracking never breaks customer flow).
- Honors `navigator.doNotTrack === '1'` and skips entirely.
- Bot detection happens server-side (UA regex) — bots are accepted by the endpoint but never persisted.
- Geographic data: server reads `x-forwarded-for` (nginx populates this), runs `geoip-lite.lookup()`, and persists only the country/city. **Client IP is never stored**.

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- All user-facing strings must support i18n (English + Swahili) via `useTranslation()`
- Translation files: `messages/en.json` and `messages/sw.json` — 836 keys each (incl. `events` + `contact` namespaces), 100% parity (required). Whole storefront is fully internationalized (products, categories, cart, checkout, account, auth, header, footer, homepage, flash sales, rentals).
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
- **Checkout → POST /orders contract (Oct 2026)**: send `{ paymentMethod, deliveryMethod: standard|express|pickup, shippingAddress: {name, phone, street, city, region}, promoCode? }` — NOT `shippingFee` (the server prices delivery: standard 5,000 / express 15,000 / pickup 0, tenant-overridable) and NOT the address stuffed into `notes`. The response carries `subtotal, discount, shippingCost/shippingFee, total`; checkout displays those once the order exists and charges `order.total` to the gateway (pre-create totals are labelled an estimate). Order-create 400s carry a readable `message` — show it.
- **Promo codes**: `POST /promo-codes/validate {code, subtotal}` always returns 200 — check `valid` (`{valid:false, discount:0, message}` when invalid). Cart applies it and stores the code in `sessionStorage.checkoutPromoCode`; checkout re-validates and sends `promoCode` on order create. The cart shows delivery as "From 5,000 — chosen at checkout" and its total excludes delivery (there is no free-over-100k rule).

## Security / SEO / a11y (Oct 2026)
- `next.config.js`: `images.remotePatterns` restricted to the API host, localhost, `*.cdninstagram.com`, `*.fbcdn.net`, `res.cloudinary.com` (was `**` = open image proxy). Mirror list in `lib/image-hosts.ts` — pass `unoptimized={!isOptimizableImage(src)}` to next/image for tenant-supplied URLs. `headers()` sets CSP (connect-src = API origin from `NEXT_PUBLIC_API_URL` **at build time**; frame-src Google Maps; gstatic for model-viewer decoders), nosniff, Referrer-Policy, Permissions-Policy (geolocation off), X-Frame-Options DENY, HSTS in prod. A new external script/iframe/API host requires a CSP update.
- Post-login `?redirect=` goes through `safeRedirectPath()` (`lib/safe-redirect.ts`): same-origin path only; rejects `//`, `/\`, control chars.
- Rich text (CMS pages, size guides) is sanitized again at render with `sanitizeHtml()` (`lib/sanitize.ts`, DOMParser allow-list, no deps). User-submitted outbound links (event socials) must pass `safeHttpsUrl()` and use `rel="noopener noreferrer nofollow"`.
- Server `layout.tsx` files in `products|categories|rentals|events|pages/[slug]` export `generateMetadata` (title, description, canonical, OpenGraph) via `lib/seo-server.ts`; product JSON-LD is server-rendered in `products/[slug]/layout.tsx` (`serializeJsonLd` escapes `< > &`). `sitemap.ts`/`robots.ts` are per-tenant: request host for absolute URLs, tenant header on fetches, nested categories flattened.
- `<html lang>` comes from the `locale` cookie (mirrored from localStorage by I18nProvider) and is kept in sync client-side.
- Gold text: use `text-gold-text` (#8A6D1A on light/standard, brand gold in dark) for prices/links on light surfaces; keep `gold-500` for fills/accents and text on dark sections.
- Modal overlays use `useDialog()` (`lib/use-dialog.ts`): focus trap, Escape, scroll lock, focus restore — pair with `role="dialog" aria-modal="true"`.
- Footer bottom bar always links `/pages/privacy-policy` (built-in privacy copy shows until the tenant publishes a CMS page with that slug).
