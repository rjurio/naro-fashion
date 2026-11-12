-- Product down-payment inheritance (Nov 2026). EXPAND-ONLY, no data rewrite.
--
-- 1. New nullable "rentalDownPaymentMode" ('INHERIT' | 'CUSTOM'). Existing
--    rows get NULL = "not yet reviewed": the stored rentalDownPaymentPct
--    keeps applying exactly as before (rentals/rental-terms.ts), so no
--    product's effective down payment changes when this runs. A stored 25 is
--    NOT reinterpreted as "inherit"; an admin chooses per product.
-- 2. Drop the column DEFAULT 25 on rentalDownPaymentPct, so a new product no
--    longer acquires a permanent 25 % override just by being created (the API
--    creates new products with mode 'INHERIT').
--
-- Production impact (read-only check 2026-11-12): 90 products, all 25 %;
-- shop default 25 %; 0 bookings; 0 effective changes. Previous application
-- code is compatible (it ignores the new column and, without the default,
-- falls back to the shop default -> 25 %).

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "rentalDownPaymentMode" TEXT,
ALTER COLUMN "rentalDownPaymentPct" DROP DEFAULT;
