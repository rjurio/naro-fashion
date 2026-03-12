# Admin Dashboard

Internal admin dashboard for Naro Fashion. Runs on port 3001.

## Stack
- Next.js 14+ (App Router), TypeScript, Tailwind CSS
- Recharts for analytics/financial charts (dynamically imported, SSR disabled)
- next-themes for Light/Dark/Luxury theme switching

## Auth
- AuthContext in `contexts/AuthContext.tsx` provides `user`, `login`, `logout`, `refreshUser`
- Providers wrapper in `app/providers.tsx` (ThemeProvider + AuthProvider)
- Login calls `POST /auth/login`, stores token in localStorage
- JWT validates against AdminUser table when `isAdmin: true` in payload
- `lib/api.ts` `getHeaders()` falls back to `localStorage.getItem('token')` when `this.token` is null

## Pages
- `/login` - Admin login (checks AdminUser table)
- `/dashboard` - Overview with stats cards, revenue chart, recent orders
- `/dashboard/products` - Product CRUD (list, create, edit, soft delete, activate/deactivate toggle, barcode generation)
- `/dashboard/products/new` - Create product with full form (basic info, pricing, rental settings, image upload with 3:4 crop, variants)
- `/dashboard/products/[id]/edit` - Edit product (same form, pre-populated)
- `/dashboard/pos` - Point of Sale (shift management, product search with barcode scan, split payments)
- `/dashboard/orders` - Order management with status updates
- `/dashboard/customers` - Customer list with search, status badges, suspend/reactivate actions
- `/dashboard/rentals` - Active rentals with expandable checklist tracking (assign templates, check/uncheck dispatch & return items)
- `/dashboard/rentals/checklists` - Checklist template CRUD with activate/deactivate toggle, proper form modal with multi-item support
- `/dashboard/rentals/requests` - Pending rental requests
- `/dashboard/flash-sales` - Flash sale CRUD
- `/dashboard/analytics` - Recharts-based analytics (revenue bars, category/status/payment pies, growth line, daily orders area)
- `/dashboard/referrals` - Referral program stats
- `/dashboard/categories` - Category management
- `/dashboard/cms` - Banners, pages, settings
- `/dashboard/shipping` - Shipping zones and rates
- `/dashboard/reviews` - Review moderation
- `/dashboard/recycle-bin` - Recycle bin with tabs: Products, Categories, Flash Sales, Checklists, Banners, Pages — restore soft-deleted items
- `/dashboard/settings` - Profile edit, password change, 2FA toggle, appearance, notifications
- `/dashboard/profile` - Admin profile view/edit
- `/dashboard/reports/rentals` - Rental reports (per-item rental count, cumulative income, rental history modal)
- `/dashboard/inventory` - Inventory management (stock levels, low-stock alerts, transaction history, valuation, EditInventoryModal, AdjustStockModal)
- `/dashboard/financials` - Financial management (Income Statement P&L, Expenses CRUD, Revenue vs Expenses chart, Expense Categories CRUD)
- `/dashboard/users` - Admin users management (create, edit, toggle, unlock locked accounts, delete)
- `/dashboard/users/roles` - Roles & Permissions management (RBAC — create custom roles, assign/remove permissions via matrix UI)

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
- `cropperjs` must be pinned to v1.6.2 in admin (v2 breaks react-cropper CSS import)
