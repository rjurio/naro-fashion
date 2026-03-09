# Admin Dashboard

Internal admin dashboard for Naro Fashion. Runs on port 3001.

## Stack
- Next.js (App Router), TypeScript, Tailwind CSS

## Pages
- `/dashboard` - Overview with stats cards, revenue chart, recent orders
- `/dashboard/products` - Product CRUD (list, create, edit, delete)
- `/dashboard/orders` - Order management with status updates
- `/dashboard/customers` - Customer list with search
- `/dashboard/rentals` - Active rentals with status management
- `/dashboard/rentals/checklists` - Checklist template CRUD
- `/dashboard/rentals/requests` - Pending rental requests
- `/dashboard/flash-sales` - Flash sale CRUD
- `/dashboard/analytics` - Revenue charts, top products, category breakdown
- `/dashboard/referrals` - Referral program stats
- `/dashboard/categories` - Category management
- `/dashboard/cms` - Banners, pages, settings
- `/dashboard/shipping` - Shipping zones and rates
- `/dashboard/reviews` - Review moderation
- `/dashboard/settings` - Admin settings

## Data Flow
- All pages fetch from NestJS API at `http://localhost:4000/api/v1`
- API client in `lib/api.ts` (AdminApiClient class with methods for all modules)
- Auth token from `localStorage('token')`, set via `adminApi.setToken(token)`
- `.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`

## Conventions
- Use `@naro/shared` for types/enums, `@naro/ui` for shared components
- Admin-only routes — requires JWT authentication
- All CRUD operations go through the adminApi client
