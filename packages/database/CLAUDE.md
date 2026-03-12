# Database Package

Prisma schema and client for Naro Fashion.

## Files
- `prisma/schema.prisma` - Database schema (40+ models)
- `prisma/seed.ts` - Seed data (admin user, categories, products, shipping zones, rental policies, CMS content)
- `.env` - Database connection string

## Models
Users, Address, Product, ProductImage, ProductVideo, ProductVariant, Category, Cart, CartItem, Wishlist, Order, OrderItem, Payment, Invoice, ShippingZone, ShippingRate, PickupPoint, Shipment, Review, RentalOrder, RentalPayment, RentalChecklistTemplate, RentalChecklistItem, RentalChecklistEntry, RentalPolicy, FlashSale, FlashSaleItem, ReferralCode, ReferralUsage, CustomerIDDocument, Banner, Page, SiteSetting, AdminUser,
InventoryTransaction, ExpenseCategory, BusinessExpense, FinancialPeriod,
Permission, Role, RolePermission, AdminUserRole, LoginAttempt

## New Models (added 2026-03)
- **InventoryTransaction** - Stock movement log (RESTOCK/SALE/RENTAL_OUT/RENTAL_RETURN/ADJUSTMENT/DAMAGE)
- **ExpenseCategory** - DB-stored expense categories (name @unique, isActive, soft-delete)
- **BusinessExpense** - Business expenses linked to ExpenseCategory, period = "YYYY-MM"
- **FinancialPeriod** - Monthly financial periods (OPEN/CLOSED/LOCKED)
- **Permission** - Granular permissions (code @unique, module:action pattern)
- **Role** - RBAC roles (name @unique, isSystem for seeded roles)
- **RolePermission** - Join table (Role ↔ Permission)
- **AdminUserRole** - Join table (AdminUser ↔ Role)
- **LoginAttempt** - Login audit log

## AdminUser additions (2026-03)
- `failedLoginAttempts`, `lockedUntil` - Account lockout support
- `passwordResetToken`, `passwordResetExpires` - Self-service password reset (SHA-256 hashed token)
- `avatarUrl`, `createdBy`, `deletedAt` - Profile and soft-delete support
- `roles AdminUserRole[]` - RBAC relation

## Product additions (2026-03)
- `purchasePrice`, `minimumStock`, `supplierName`, `supplierContact`, `lastRestockedAt` - Inventory management fields
- `inventoryTransactions InventoryTransaction[]` - Transaction log relation

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
- P2002 = unique constraint violation → catch in service layer and throw NestJS ConflictException
