# Database Package

Prisma schema and client for Naro Fashion.

## Files
- `prisma/schema.prisma` - Database schema (30+ models)
- `prisma/seed.ts` - Seed data (admin user, categories, products, shipping zones, rental policies, CMS content)
- `.env` - Database connection string

## Models
Users, Address, Product, ProductImage, ProductVideo, ProductVariant, Category, Cart, CartItem, Wishlist, Order, OrderItem, Payment, Invoice, ShippingZone, ShippingRate, PickupPoint, Shipment, Review, RentalOrder, RentalPayment, RentalChecklistTemplate, RentalChecklistItem, RentalChecklistEntry, RentalPolicy, FlashSale, FlashSaleItem, ReferralCode, ReferralUsage, CustomerIDDocument, Banner, Page, SiteSetting, AdminUser

## Commands
- `pnpm prisma generate` - Generate Prisma client
- `pnpm prisma db push` - Push schema to DB (also generates client)
- `pnpm prisma migrate dev` - Create and run migrations
- `pnpm prisma studio` - Open Prisma Studio GUI
- `pnpm prisma db seed` - Run seed script

## Conventions
- All schema changes go in `schema.prisma`
- Export Prisma client for use by other packages/apps
- PostgreSQL 17, database: `naro_fashion`, user: `naro_admin`
- Use local Prisma v6.19.2 (global v7 has breaking changes) — always run from this directory
