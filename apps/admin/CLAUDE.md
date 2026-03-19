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
- JWT validates against AdminUser (isAdmin) or PlatformAdmin (isPlatformAdmin)
- `lib/api.ts` includes platform/tenant API methods (getTenants, createTenant, etc.)
- Sidebar (`components/layout/Sidebar.tsx`) shows platform nav for platform admins, tenant nav (filtered by `enabledModules`) for tenant admins

## Pages

### Platform Admin Pages (isPlatformAdmin)
- `/platform-login` - Platform admin login (checks PlatformAdmin table)
- `/platform` - Platform dashboard (total tenants, MRR, active/trial/suspended counts, recent payments)
- `/platform/tenants` - Tenant list with search, status badges, plan info
- `/platform/tenants/new` - Create tenant wizard (company info, admin user, plan, branding colors)
- `/platform/tenants/[id]` - Tenant detail (status, modules toggle, payment history, suspend/activate)
- `/platform/plans` - Subscription plan CRUD (name, price, limits, modules)
- `/platform/payments` - All tenant payments across platform

### Tenant Admin Pages
- `/login` - Admin login (checks AdminUser table)
- `/dashboard` - Overview with stats cards, revenue chart, recent orders
- `/dashboard/products` - Product CRUD (list, create, edit, soft delete, activate/deactivate toggle, barcode generation)
- `/dashboard/products/new` - Create product with full form (basic info, pricing, rental settings, image upload with 3:4 crop, variants)
- `/dashboard/products/[id]/edit` - Edit product (same form, pre-populated)
- `/dashboard/pos` - Point of Sale (shift management, product search with barcode scan, split payments)
- `/dashboard/orders` - Order management with status updates
- `/dashboard/customers` - Customer list with search, status badges, suspend/reactivate actions
- `/dashboard/rentals` - Active rentals with expandable details (wedding date/location/region, delivery modality, shipping/transport info, receipt upload) and checklist tracking (assign templates, check/uncheck dispatch & return items)
- `/dashboard/rentals/checklists` - Checklist template CRUD with activate/deactivate toggle, proper form modal with multi-item support
- `/dashboard/rentals/requests` - Pending rental requests
- `/dashboard/flash-sales` - Flash sale CRUD
- `/dashboard/analytics` - Recharts-based analytics (revenue bars, category/status/payment pies, growth line, daily orders area)
- `/dashboard/referrals` - Referral program stats
- `/dashboard/categories` - Category management
- `/dashboard/cms` - Banners, pages, settings, Instagram posts (with IG API sync, pin/unpin, source badges)
- `/dashboard/shipping` - Shipping zones and rates
- `/dashboard/reviews` - Review moderation
- `/dashboard/recycle-bin` - Recycle bin with tabs: Products, Categories, Flash Sales, Checklists, Banners, Pages — restore soft-deleted items
- `/dashboard/settings` - Profile edit, password change, 2FA toggle, appearance, notifications
- `/dashboard/settings/payment-methods` - Payment Methods CRUD (name, code, uploaded+cropped icon, description, integration key/params, active toggle, sort order)
- `/dashboard/profile` - Admin profile view/edit
- `/dashboard/reports/rentals` - Rental reports (per-item rental count, cumulative income, rental history modal)
- `/dashboard/inventory` - Inventory management (stock levels, low-stock alerts, transaction history, valuation, EditInventoryModal, AdjustStockModal)
- `/dashboard/financials` - Financial management (Income Statement P&L, Expenses CRUD, Revenue vs Expenses chart, Expense Categories CRUD)
- `/dashboard/users` - Admin users management (create, edit, toggle, unlock locked accounts, delete)
- `/dashboard/users/roles` - Roles & Permissions management (RBAC — create custom roles, assign/remove permissions via matrix UI)
- `/dashboard/newsletter` - Newsletter dashboard (stats cards, recent newsletters)
- `/dashboard/newsletter/compose` - Compose newsletter (template type selector, HTML editor with preview, NEW_ARRIVALS auto-product fetch, save draft / send)
- `/dashboard/newsletter/sent` - Sent newsletters list with delivery stats
- `/dashboard/newsletter/subscribers` - Subscriber list with search, pagination, stats bar
- `/dashboard/newsletter/[id]` - Newsletter detail with delivery stats, failed deliveries table, resend button

## Key Components
- `components/layout/Sidebar.tsx` - Navigation sidebar with logo icon
- `components/layout/TopBar.tsx` - Top bar with search, theme toggle, user dropdown (real name/role from AuthContext)
- `app/dashboard/analytics/charts.tsx` - Recharts chart components (RevenueChart, CategoryPieChart, DailyOrdersChart, CustomerGrowthChart, StatusPieChart, PaymentPieChart)
- `app/dashboard/financials/charts.tsx` - FinancialBarChart (Revenue/Expenses/NetProfit bars, dynamically imported)
- `components/products/ProductForm.tsx` - Reusable product create/edit form (basic info, pricing, rental, images, variants)
- `components/products/ImageUploader.tsx` - Drag-and-drop image upload with thumbnail grid (max 8, 5MB limit)
- `components/products/ImageCropModal.tsx` - 3:4 aspect ratio image cropper (react-cropper, quality slider, 900×1200 output)
- `components/products/BarcodeLabel.tsx` - Barcode label preview (JsBarcode CODE128, product name, price in TZS)
- `components/products/BarcodeModal.tsx` - Barcode PDF generation (jsPDF, 3×9 labels per A4, quantity selector, print dialog)
- `components/products/Model3dUploader.tsx` - 3D model upload (drag-drop GLB/GLTF, max 25MB, live model-viewer preview, remove button)

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
- Auth token from `localStorage('token')`, set via `adminApi.setToken(token)`
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
- NEVER use alert() or window.confirm() — always use useToast() and useConfirm()
- All forms use FormField wrapper for consistent label/error/hint layout
- All modals use Modal component for consistent UX
- All page headers use PageHeader component with breadcrumbs
- Recharts must be dynamically imported with `{ ssr: false }` (see financials/charts.tsx)
- Product form labels use `InfoLabel` component with hover tooltips for field descriptions
- SKU auto-generated as `CATEGORY-NAME-NUMBER` (e.g. GOW-ELE-427), editable by admin
- URL slug is read-only, always auto-generated from English product name
- Image uploads: local storage via API at `/uploads/products/`, served via ServeStaticModule
- Tailwind v4: No tailwind.config.ts — theme defined via @theme in globals.css
- `cropperjs` must be pinned to v1.6.2 in admin (v2 breaks react-cropper CSS import)
