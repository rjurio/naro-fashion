# API (NestJS)

REST API backend for Naro Fashion. Runs on port 4000, prefix `/api/v1`.

## Stack
- NestJS, TypeScript, Prisma ORM, PostgreSQL 17
- Passport.js + JWT for authentication
- class-validator + class-transformer for DTOs
- Cloudinary for image uploads

## Modules (all fully implemented)
- **auth** - Login, register, JWT access/refresh tokens, profile
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
- **cms** - Banners, pages, site settings CRUD
- **analytics** - Dashboard stats, revenue charts
- **notifications** - Email + SMS sending
- **upload** - Cloudinary file upload
- **scheduler** - Cron jobs for reminders and overdue alerts

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
