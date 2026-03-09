# API (NestJS)

REST API backend for Naro Fashion. Runs on port 4000, prefix `/api/v1`.

## Stack
- NestJS, TypeScript, Prisma ORM, PostgreSQL 17
- Passport.js + JWT for authentication
- class-validator + class-transformer for DTOs
- Cloudinary for image uploads

## Authentication
- Dual-table auth: `User` (customers) and `AdminUser` (admin staff)
- `validateUser()` checks both tables, returns `isAdmin: true` for AdminUser
- `generateTokens()` includes `isAdmin` and `role` in JWT payload
- `JwtStrategy.validate()` checks AdminUser first if `payload.isAdmin`, then User, then AdminUser fallback
- Endpoints: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`
- Profile: `GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`, `PATCH /auth/2fa`

## Modules (all fully implemented)
- **auth** - Login, register, JWT access/refresh tokens, profile, password change, 2FA toggle
- **users** - User CRUD, addresses
- **products** - Full CRUD with variants, images, search, filtering
- **categories** - Nested category tree CRUD
- **cart** - Add/update/remove items, merge guest cart, count
- **wishlist** - Toggle, check, count
- **orders** - Create from cart, status workflow, admin listing, stats
- **payments** - Create, update status, webhooks, payment summary
- **shipping** - Zones CRUD, rate calculation, shipment tracking
- **reviews** - Create, approve/reject, rating stats, product aggregation
- **rentals** - Booking, availability check, status workflow, upcoming pickups
- **rental-checklists** - Templates CRUD, assign to rental, check/uncheck items
- **rental-policies** - Global policy settings (buffer days, late fees, etc.)
- **flash-sales** - Time-limited sales CRUD with product pricing
- **referrals** - Referral code tracking and stats
- **id-verification** - National ID upload, admin approve/reject
- **cms** - Banners, pages, site settings CRUD (also stores admin notification prefs as JSON)
- **analytics** - Dashboard stats (revenue, orders, customers, rentals, top products, category breakdown, distributions, growth), revenue charts (daily/weekly/monthly with sales + rentals)
- **notifications** - Email + SMS sending
- **upload** - Cloudinary file upload
- **scheduler** - Cron jobs for reminders and overdue alerts

## Analytics API
- `GET /analytics/dashboard` - Returns: totalRevenue, totalOrders, customerCount, activeRentals, rentalRevenue, avgOrderValue, percentage changes, topProducts (enriched with names), categoryBreakdown, orderStatusDistribution, paymentMethodDistribution, customerGrowth, rentalStatusDistribution, dailyOrders
- `GET /analytics/revenue?period=daily|weekly|monthly` - Returns combined sales + rental revenue grouped by period

## Conventions
- Each feature is a NestJS module in `src/`
- Use Prisma client from `@naro/database` for all DB access
- Use DTOs with class-validator for request validation
- Use `JwtAuthGuard` for protected endpoints
- RESTful endpoint naming under `/api/v1/`
- Shared types/enums from `@naro/shared`

## Database
- Connection string in `.env` and `packages/database/.env`
- Schema in `packages/database/prisma/schema.prisma`
- Generate client: `cd packages/database && pnpm prisma generate`
