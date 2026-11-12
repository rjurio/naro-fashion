-- Expand-only (PR #16, revised 48 h hold rules): three nullable columns + an
-- index. No data is written; existing bookings are classified by the hold
-- expiry job at runtime (rentals/rental-hold.ts adoptLegacyHold).
-- AlterTable
ALTER TABLE "RentalOrder" ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "holdReminderFor" TIMESTAMP(3),
ADD COLUMN     "holdState" TEXT;

-- CreateIndex
CREATE INDEX "RentalOrder_status_holdExpiresAt_idx" ON "RentalOrder"("status", "holdExpiresAt");

