# Admin Dashboard

Admin dashboard for Naro Fashion. Runs on port 3001.
Serves both **tenant admin** (SUPER_ADMIN, MANAGER, STAFF) and **platform admin** (manages all tenants).

## Stack
- Next.js 15+ (App Router), React 19, TypeScript, Tailwind CSS v4
- Recharts for analytics/financial charts (dynamically imported, SSR disabled)
- next-themes for Light/Dark/Luxury theme switching

## Theming
- ThemeProvider: `attribute="class"`, themes: `light | dark | luxury`, `enableSystem={false}` (in `app/providers.tsx`)
- **First-visit auto-detection**: Inline `<script>` in `app/layout.tsx` runs before React hydrates — reads `prefers-color-scheme`, sets `localStorage('theme')` and `class` on `<html>` (dark→`dark`, else→`light`)
- **Returning visitors**: next-themes reads `localStorage('theme')` — user's manual choice is preserved
- Theme toggle in TopBar dropdown cycles: light, dark, luxury

## Auth
- AuthContext in `contexts/AuthContext.tsx` provides `user`, `login`, `platformLogin`, `logout`, `refreshUser`, `isPlatformAdmin`, `enabledModules`, `isModuleEnabled()`
- **Tenant admin login**: `/login` → `POST /auth/login` → tenant admin dashboard (`/dashboard/*`)
- **Platform admin login**: `/platform-login` → `POST /auth/platform-login` → platform dashboard (`/platform/*`)
- **Remember Me**: Login checkbox controls token storage — checked: `localStorage` (persists across sessions), unchecked: `sessionStorage` (cleared on browser close). Default: unchecked. `login()` in AuthContext accepts `rememberMe` param.
- JWT validates against AdminUser (isAdmin) or PlatformAdmin (isPlatformAdmin)
- `lib/api.ts` checks both `localStorage` and `sessionStorage` for token: `localStorage.getItem('token') || sessionStorage.getItem('token')` in all `getHeaders()` and upload methods
- `logout()` clears both `localStorage` and `sessionStorage` token entries
- Sidebar (`components/layout/Sidebar.tsx`) shows platform nav for platform admins, tenant nav (filtered by `enabledModules`) for tenant admins

## Pages

### Platform Admin Pages (isPlatformAdmin)
- `/platform-login` - Platform admin login (checks PlatformAdmin table)
- `/platform` - Platform dashboard (total tenants, MRR, active/trial/suspended counts, recent payments)
- `/platform/tenants` - Tenant list with search, status badges, plan info
- `/platform/tenants/new` - Create tenant wizard (company info, admin user, plan, branding colors)
- `/platform/tenants/[id]` - Tenant detail (status, modules toggle, payment history, suspend/activate)
- `/platform/plans` - Subscription plan CRUD (name, price, limits, modules)
- `/platform/payments` - All tenant payments across the platform: summary cards (Completed/Pending totals, record count), status filter (All/Completed/Pending/Failed), search by tenant/invoice/transaction-ref, CSV export, full payment table

### Tenant Admin Pages
- `/login` - Admin login (checks AdminUser table)
- `/dashboard` - Overview with stats cards, revenue chart, recent orders
- `/dashboard/products` - Product CRUD (list, create, edit, soft delete, activate/deactivate toggle, barcode generation). **Template + Import CSV buttons** in header: "Template" downloads a pre-filled CSV with all columns and 2 example rows (client-side, no API); "Import CSV" opens `ImportProductsModal` that uploads to `POST /products/bulk-import` and shows created/failed/errors summary with per-row feedback.
- `/dashboard/products/new` - Create product with full form (basic info, pricing, rental settings, image upload with 3:4 crop, variants)
- `/dashboard/products/[id]/edit` - Edit product (same form, pre-populated)
- `/dashboard/pos` - Point of Sale (shift management, product search with barcode scan, split payments)
- `/dashboard/orders` - Order management with status updates
- `/dashboard/customers` - Customer list with search, status badges, suspend/reactivate actions. Calls `GET /users` (admin endpoint with order/rental counts and total spent)
- `/dashboard/rentals` - Active rentals with expandable details (wedding date/location/region, delivery modality, shipping/transport info, receipt upload), checklist tracking (assign templates, check/uncheck dispatch & return items), custom `RentalStatusDropdown` (color-coded icons per status, progress bar, forward-only transitions, past statuses disabled)
- `/dashboard/rentals/checklists` - Checklist template CRUD with activate/deactivate toggle, proper form modal with multi-item support
- `/dashboard/rentals/requests` - Pending rental requests
- `/dashboard/flash-sales` - Flash sale CRUD
- `/dashboard/analytics` - Business analytics (revenue bars, category/status/payment pies, growth line, daily orders area). Sidebar groups it under "Analytics" alongside the new "Visitors" sub-page.
- `/dashboard/analytics/visitors` - **Visitor analytics dashboard** (added 2026-04-25). Anonymous storefront traffic insights: overview cards (page views, unique visitors, avg pages/visit) with prev-period change badges, timeseries area chart (views + sessions overlaid), top pages bar list, countries list with flag emoji + percentage bars, device/browser/OS donuts, day-of-week × hour-of-day heatmap, top referrers. Date range picker (24h/7d/30d/90d). Charts dynamically imported with `ssr: false` (Recharts pattern). Calls 7 endpoints under `/analytics/visitors/*`. Tracking is gated by the `analytics_visitor_tracking_enabled` SiteSetting and bypasses entirely on `Do-Not-Track` browsers — no opt-out UI needed because the tenant either has the analytics module or doesn't.
- `/dashboard/referrals` - Referral program stats
- `/dashboard/categories` - Category management. **Field-name compat**: the API returns Prisma-native `name` / `nameSwahili` and `_count.products`, but older admin code read `nameEn` / `nameSw` / `productCount`. The page reads both shapes with fallbacks (`cat.name ?? cat.nameEn`, `cat.nameSwahili ?? cat.nameSw`, `cat._count?.products ?? cat.productCount ?? 0`) so it works with either API version.
- `/dashboard/cms` - Banners, pages (RichTextEditor for EN/SW content), settings, Instagram posts (with IG API sync, configurable auto-sync interval, pin/unpin, source badges). The `/dashboard/cms/settings` Features group exposes 4 Instagram-feed knobs alongside the existing `instagram_feed_visible` toggle: `instagram_feed_layout` (`single_row`/`multi_row`, default `single_row`), `instagram_feed_rows` (2/3/4/5 — only used when `multi_row`, default `2`), and `instagram_feed_max_posts` (6/12/18/24/30, default `30` — hard cap). The storefront resolves visible count as `min(max_posts, layout === 'single_row' ? 6 : rows × 6)`.
- `/dashboard/cms/parallax-sections` - **Parallax Sections CRUD** (full per-section image/effect management). One row per known section (HERO_AMBIENT, CATEGORIES, NEW_ARRIVALS, RENTAL, WEDDINGS, INSTAGRAM, FOOTER_BAND), each with its own `effectType` (TRANSLATE_VERTICAL, TRANSLATE_HORIZONTAL, FIXED, ZOOM_ON_SCROLL, MIRROR, MOUSE_TILT, STATIC), scroll speed slider (0.05–0.8), overlay opacity slider, overlay color picker, blur slider (0–30px), active toggle, sort order. Live preview pane reproduces each effect inside the modal so the admin sees the chosen movement before publishing. Master enable toggle lives in `/dashboard/cms/settings` Features group as `parallax_enabled`. `parallax_default_fallback` setting (BRAND_GRADIENT / BRAND_RADIAL / BRAND_MESH / NONE) controls what renders for sections without an uploaded image — uses the tenant's brand colors via CSS variables. Image upload uses the new `parallaxBackdrop` preset (16:9 landscape, 1920×1080, JPEG q 0.82). Soft-delete via the "Parallax Sections" tab on `/dashboard/recycle-bin`.
- `/dashboard/shipping` - Shipping zones and rates
- `/dashboard/reviews` - Review moderation
- `/dashboard/recycle-bin` - Recycle bin with tabs: Products, Categories, Flash Sales, Checklists, Banners, Pages — restore soft-deleted items
- `/dashboard/settings` - Profile edit, password change, 2FA toggle, appearance, notifications
- `/dashboard/settings/payment-methods` - Payment Methods CRUD (name, code, uploaded+cropped icon, description, integration key/params, active toggle, sort order). The generic `integrationParams` JSON textarea is how tenants configure each gateway — no gateway-specific UI needed. Supported codes today: `SELCOM` (global env creds; `integrationParams` empty/optional). Supported code planned: **`CLICKPESA_MIXX`** — paste `{ "clientId": "…", "apiKey": "…", "checksumSecret": "…", "usePreview": true, "webhookIpAllowlist": [] }` from the ClickPesa Dashboard → Settings → Developers → Applications. When active with the `MOBILE_MONEY` method, the API resolves this PaymentMethod per tenant and routes USSD pushes through ClickPesa's Mixx-by-YAS channel (prefixes 071/065/067/077). Plan: `C:\Users\rjurio\.claude\plans\groovy-painting-pudding.md`.
- `/dashboard/settings/business-profile` - Business Profile with identity, branding, contact, **location** (map_latitude/map_longitude with validation + browser geolocation auto-detect + live map preview), social media, website settings
- `/dashboard/profile` - Admin profile view/edit
- `/dashboard/reports/rentals` - Rental reports (per-item rental count, cumulative income, rental history modal)
- `/dashboard/inventory` - Inventory management (stock levels, low-stock alerts, transaction history, valuation, EditInventoryModal, AdjustStockModal)
- `/dashboard/financials` - Financial management (Income Statement P&L, Expenses CRUD, Revenue vs Expenses chart, Expense Categories CRUD)
- `/dashboard/users` - Admin users management (create, edit, toggle, unlock locked accounts, delete)
- `/dashboard/users/roles` - Roles & Permissions management (RBAC — create custom roles, assign/remove permissions via matrix UI)
- `/dashboard/audit-log` - Global audit trail log with filters (admin user, entity, action, date range, search), expandable JSON details, pagination, CSV export. 29 audit points across 8 services.
- `/dashboard/newsletter` - Newsletter dashboard (stats cards, recent newsletters)
- `/dashboard/newsletter/compose` - Compose newsletter (template type selector, RichTextEditor with Visual/HTML toggle + image upload + preview, NEW_ARRIVALS auto-product fetch, save draft / send)
- `/dashboard/newsletter/sent` - Sent newsletters list with delivery stats
- `/dashboard/newsletter/subscribers` - Subscriber list with search, pagination, stats bar
- `/dashboard/newsletter/[id]` - Newsletter detail with delivery stats, failed deliveries table, resend button

## Key Components
- `components/layout/Sidebar.tsx` - Navigation sidebar with logo icon
- `components/layout/TopBar.tsx` - Top bar with search, theme toggle, user dropdown (real name/role from AuthContext)
- `app/dashboard/analytics/charts.tsx` - Recharts chart components (RevenueChart, CategoryPieChart, DailyOrdersChart, CustomerGrowthChart, StatusPieChart, PaymentPieChart)
- `app/dashboard/financials/charts.tsx` - FinancialBarChart (Revenue/Expenses/NetProfit bars, dynamically imported)
- `components/products/ProductForm.tsx` - Reusable product create/edit form (basic info, pricing, rental, images, variants)
- `components/products/ImageUploader.tsx` - Drag-and-drop image upload with thumbnail grid (max 8). Reads its limits from the `product` preset in `@naro/shared/image-presets` — passes `preset={PRODUCT_PRESET}` into `<ImageCropModal>`. Validates min source dims (900×1200) before opening the cropper.
- `components/products/ImageCropModal.tsx` - Parameterized image cropper (react-cropper). Accepts optional `preset` prop. **Defaults preserved**: 3:4 / 900×1200 / JPEG q 0.80 / quality slider 40–100. When `preset.outputMime === 'image/png'` the slider is hidden (lossless). When `preset.outputMime === 'passthrough'` the modal must not be opened by the caller — `PresetImageUploadField` handles SVG/PDF passthrough by skipping the crop UI.
- `components/ui/PresetImageUploadField.tsx` - **Unified image-upload component**. Reads from `IMAGE_PRESETS` (in `@naro/shared`) by `presetKey` prop. Handles file pick → mime/size/min-source-dim validation → optional crop modal → upload via the right `adminApi.upload*` method (dispatch by `preset.uploadEndpoint`) → preview with replace/remove. Supports single mode (`value` + `onChange`) and multi mode (`values` + `onChangeMany` + `multiple` + `max`). SVG payment icons + ID documents bypass the cropper via `skipCrop`. Used by hero-slides, categories, banners, instagram-posts, events (cover + gallery), payment-methods, and the legacy `ImageUploadField` wrapper used by business-profile.
- `components/ui/ImageUploadField.tsx` - Legacy single-image field for business-profile (preserves `currentUrl`/`defaultUrl`/`onUpload`/`onReset` callback shape). Now accepts an optional `presetKey` prop — when set, runs preset validation + crop pipeline before passing the cropped File to `onUpload`. Backward-compatible when `presetKey` is omitted.
- `components/products/BarcodeLabel.tsx` - Barcode label preview (JsBarcode CODE128, product name, price in TZS)
- `components/products/BarcodeModal.tsx` - Barcode PDF generation (jsPDF, 3×9 labels per A4, quantity selector, print dialog)
- `components/products/Model3dUploader.tsx` - 3D model upload (drag-drop GLB/GLTF, max 25MB, live model-viewer preview, remove button)
- `components/ui/RichTextEditor.tsx` - Rich text editor (react-quill-new) with Visual/HTML toggle, image upload, full formatting (headings, fonts, sizes, colors, lists, indent, alignment, links, images, video, blockquotes, code blocks). Used in: Newsletter compose, CMS Pages, Size Guides.
- `components/ui/NavigationProgress.tsx` - YouTube-style gold progress bar at top of page during route changes. Added to dashboard and platform layouts via Suspense boundary.

## UI Foundation Components (all in `components/ui/`)
- `Toast.tsx` / `contexts/ToastContext.tsx` - ToastProvider + useToast() hook (success/error/warning/info, top-right, auto-dismiss 4s)
- `ConfirmDialog.tsx` - ConfirmDialogProvider + useConfirm() hook (replaces window.confirm())
- `Skeleton.tsx` - Skeleton, SkeletonTable, SkeletonCard (shimmer loading states)
- `EmptyState.tsx` - Empty state with icon, title, description, CTA button
- `Modal.tsx` - Reusable modal (size sm/md/lg/xl, focus trap, Escape to close)
- `Badge.tsx` - Status badges (success/warning/error/info/neutral/purple/gold)
- `PageHeader.tsx` - Page header with breadcrumbs and action slot (NAMED export: `import { PageHeader }`)
- `FormField.tsx` - Form field wrapper with label, error, hint
- `InfoLabel.tsx` - Label with info icon tooltip on hover (used in ProductForm for field descriptions)

## Data Flow
- All pages fetch from NestJS API at `http://localhost:4000/api/v1`
- API client in `lib/api.ts` (AdminApiClient class with methods for all modules)
- Auth token from `localStorage('token')` or `sessionStorage('token')` (depends on Remember Me), set via `adminApi.setToken(token)`
- `.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`

## Assets
- `public/logo.jpg` - Full Naro Fashion logo (used on login page branding panel)
- `public/icon.jpg` - Circular icon (used in sidebar, mobile login)
- `public/favicon.jpg` - Browser tab icon

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- Admin-only routes — requires JWT authentication
- All CRUD operations go through the adminApi client
- When lucide-react `Image` conflicts with `next/image`, alias as `ImageIcon`
- Always use `|| []` and `?? 0` fallbacks for API data that may be undefined
- All delete actions are soft deletes (items go to recycle bin, can be restored)
- Products fetched via `/products/admin` to include inactive items in admin view
- NEVER use alert(), window.confirm(), or window.prompt() — always use useToast() for notifications, useConfirm() for destructive confirmations, and inline UI (select/input) for user input. All native browser dialogs have been eliminated project-wide.
- **All action buttons** (toggle, approve, reject, suspend, delete, pin, sync) MUST have loading states: `disabled={loadingId === item.id}` + Loader2 spinner replacing the icon during API calls. Use a `useState<string | null>(null)` pattern per action type.
- Navigation progress bar (gold #D4AF37) shows at top of page during route changes — added to both dashboard and platform layouts via `NavigationProgress` component
- All forms use FormField wrapper for consistent label/error/hint layout
- All modals use Modal component for consistent UX
- All page headers use PageHeader component with breadcrumbs
- `StatsCard` component uses `min-w-0 flex-1` on text + `flex-shrink-0` on icon so long values (e.g. `TSh 6,491,000`) wrap instead of clipping. Value text is responsive: `text-xl xl:text-2xl`. 6-card grids should use `2xl:grid-cols-6` (not `xl:grid-cols-6`) to keep cards breathable on common resolutions.
- Recharts must be dynamically imported with `{ ssr: false }` (see financials/charts.tsx)
- Product form labels use `InfoLabel` component with hover tooltips for field descriptions
- SKU auto-generated as `CATEGORY-NAME-NUMBER` (e.g. GOW-ELE-427), editable by admin
- URL slug is read-only, always auto-generated from English product name
- Image uploads: local storage via API at `/uploads/products/`, served via ServeStaticModule
- **Unified image upload policy**: every uploader in the admin (and the storefront ID-doc path) consumes `IMAGE_PRESETS` from `@naro/shared`. Presets define output dims, JPEG/PNG quality, min source dims, max file size, and allowed mimes per render context — sized so the upload covers the largest storefront CSS box at 2× DPR. New uploaders MUST use `<PresetImageUploadField presetKey="..." />` rather than rolling their own file input + adminApi call. Adding a new context: add a key to `image-presets.ts`, add the corresponding `/upload/<endpoint>` route in `upload.controller.ts`, and add the matching admin API client method. The hero-slide cropper was previously 16:7 (1920×700) but rendered against a 3:4 storefront card — fixed in this pass; existing rows are left untouched and admins re-upload at their leisure.
- Tailwind v4: No tailwind.config.ts — theme defined via @theme in globals.css
- `cropperjs` must be pinned to v1.6.2 in admin (v2 breaks react-cropper CSS import)
- **Native `<select>` option theming** (`app/globals.css`): browsers only honor `background-color` + `color` on `<option>` elements — no border-radius, padding, or font overrides apply. A single global rule (`select option, select optgroup { background-color: hsl(var(--card)); color: hsl(var(--card-foreground)); }`) themes every select in the admin at once (forms, filters, stock adjust modal, expense filters, etc.). Don't inline-style per `<option>` and don't swap for a custom listbox unless the design requires rich rows.
