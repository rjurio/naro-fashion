# Naro Fashion - Monorepo

## Project Overview
B2C e-commerce platform for fashion & clothing in Tanzania. Turborepo monorepo.
Target market: Tanzania (local payment methods, Swahili translations).
GitHub: https://github.com/rjurio/naro-fashion

## Architecture
- `apps/storefront/` - Customer-facing Next.js PWA (port 3000)
- `apps/admin/` - Admin dashboard Next.js (port 3001)
- `apps/api/` - NestJS REST API (port 4000, prefix `/api/v1`)
- `packages/database/` - Prisma schema + client (PostgreSQL)
- `packages/shared/` - Shared types, enums, constants
- `packages/ui/` - Shared UI components

## Tech Stack
- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, next-themes, next-intl
- **Backend**: NestJS, Prisma ORM, PostgreSQL 17
- **Auth**: JWT (access + refresh tokens), Passport.js, dual-table auth (User + AdminUser)
- **Charts**: Recharts (dynamically imported with `ssr: false` to avoid SSR issues)
- **Languages**: English + Swahili (i18n via next-intl)
- **Brand Colors**: Black (#1A1A1A), Gold (#D4AF37)
- **Logo**: `public/logo.jpg` (full logo), `public/icon.jpg` (circular icon), `public/favicon.jpg` (browser tab)

## Commands
- `pnpm dev` - Start all apps in dev mode
- `pnpm build` - Build all packages/apps
- `pnpm lint` - Lint all packages/apps
- `pnpm db:generate` - Generate Prisma client (run from `packages/database/`)
- `pnpm db:push` - Push schema to database
- `pnpm db:migrate` - Run Prisma migrations
- `pnpm db:studio` - Open Prisma Studio

## Database
- PostgreSQL 17, database: `naro_fashion`, user: `naro_admin`, password: `Admin123`
- Schema lives in `packages/database/prisma/schema.prisma`
- 30+ models: Users, AdminUser, Products, Categories, Cart, Wishlist, Orders, Payments, Shipping, Reviews, Rentals, RentalChecklists, RentalPolicies, FlashSales, Referrals, CMS (Banners, Pages, Settings)
- Database is seeded with initial data (admin user, categories, products, shipping zones, rental policies, CMS content)

## Authentication
- Dual user tables: `User` (customers) and `AdminUser` (admin staff with roles: SUPER_ADMIN, MANAGER, STAFF)
- JWT payload includes `sub`, `email`, `isAdmin`, `role`
- Admin login checks both tables; JWT strategy validates against correct table based on `isAdmin` flag
- Token stored in `localStorage('token')`, auto-injected as Bearer header
- Admin also supports cookies (httpOnly access_token + refresh_token)

## Key Domain Concepts
- **Rental System**: Gowns/formal wear rentals with National ID verification, 25% down payment, 7-day buffer between rentals, admin checklists (DISPATCH + RETURN)
- **Product Availability**: PURCHASE_ONLY, RENTAL_ONLY, or BOTH
- **Themes**: Light, Dark, Luxury (CSS variables via next-themes)
- **Payments**: Mobile Money (M-Pesa, Tigo Pesa, Airtel Money), cards, bank transfer, COD

## API Modules (all fully implemented with Prisma CRUD)
analytics, auth, cart, categories, cms, flash-sales, id-verification, notifications, orders, payments, products, referrals, rental-checklists, rental-policies, rentals, reviews, scheduler, shipping, upload, users, wishlist

## Frontend Data Flow
- Both storefront and admin fetch data from the NestJS API at `http://localhost:4000/api/v1`
- Auth token stored in `localStorage('token')`, auto-injected as Bearer header
- Storefront API client: `apps/storefront/lib/api.ts` (domain-specific: productsApi, cartApi, ordersApi, etc.)
- Admin API client: `apps/admin/lib/api.ts` (AdminApiClient class with all CRUD methods, `getHeaders()` falls back to localStorage)
- Admin uses AuthContext (`apps/admin/contexts/AuthContext.tsx`) for auth state management

## Coding Conventions
- Use TypeScript strict mode everywhere
- Shared types/enums go in `packages/shared/`, not duplicated across apps
- API endpoints follow RESTful conventions in NestJS modules
- Use Prisma for all database access — no raw SQL unless absolutely necessary
- Use DTOs with class-validator for request validation in API
- Prefer open-source and free-tier solutions
- When importing `Image` from both `next/image` and `lucide-react`, alias lucide's as `ImageIcon`

## Known Issues
- Global Prisma CLI is v7.4.2 which has breaking changes — always use local Prisma v6.19.2 via `pnpm prisma` from `packages/database/`
- OneDrive sync can cause EPERM errors during `prisma generate` — retry usually works, or use `prisma db push` which also triggers generate
- Recharts must be dynamically imported with `{ ssr: false }` in Next.js to avoid server-side rendering errors
- API response fields may be undefined when database has no data — always use `?? 0`, `|| '0%'`, `|| []` fallbacks
