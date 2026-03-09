# Admin Dashboard

Internal admin dashboard for Naro Fashion. Runs on port 3001.

## Stack
- Next.js 14+ (App Router), TypeScript, Tailwind CSS
- Recharts for analytics charts (dynamically imported, SSR disabled)
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
- `/dashboard/products` - Product CRUD (list, create, edit, delete)
- `/dashboard/orders` - Order management with status updates
- `/dashboard/customers` - Customer list with search
- `/dashboard/rentals` - Active rentals with status management
- `/dashboard/rentals/checklists` - Checklist template CRUD
- `/dashboard/rentals/requests` - Pending rental requests
- `/dashboard/flash-sales` - Flash sale CRUD
- `/dashboard/analytics` - Recharts-based analytics (revenue bars, category/status/payment pies, growth line, daily orders area)
- `/dashboard/referrals` - Referral program stats
- `/dashboard/categories` - Category management
- `/dashboard/cms` - Banners, pages, settings
- `/dashboard/shipping` - Shipping zones and rates
- `/dashboard/reviews` - Review moderation
- `/dashboard/settings` - Profile edit, password change, 2FA toggle, appearance, notifications
- `/dashboard/profile` - Admin profile view/edit

## Key Components
- `components/layout/Sidebar.tsx` - Navigation sidebar with logo icon
- `components/layout/TopBar.tsx` - Top bar with search, theme toggle, user dropdown (real name/role from AuthContext)
- `app/dashboard/analytics/charts.tsx` - Recharts chart components (RevenueChart, CategoryPieChart, DailyOrdersChart, CustomerGrowthChart, StatusPieChart, PaymentPieChart)

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
