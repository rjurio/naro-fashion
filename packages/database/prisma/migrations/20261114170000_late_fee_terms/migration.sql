-- Late-fee rules LF-2026-11 (expand-only): nullable shop-policy fields (null =
-- approved defaults), the terms stored on each NEW booking, the waived amount,
-- and independently approved waivers. No existing row changes value.

-- AlterTable
ALTER TABLE "RentalOrder" ADD COLUMN     "lateFeeTerms" JSONB,
ADD COLUMN     "lateFeeWaived" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RentalPolicy" ADD COLUMN     "defaultLateFeePct" DECIMAL(5,2),
ADD COLUMN     "freeRentalLateFeePerDay" DECIMAL(12,2),
ADD COLUMN     "lateFeeCapPct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "RentalLateFeeWaiver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalLateFeeWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalLateFeeWaiver_tenantId_idx" ON "RentalLateFeeWaiver"("tenantId");

-- CreateIndex
CREATE INDEX "RentalLateFeeWaiver_rentalOrderId_idx" ON "RentalLateFeeWaiver"("rentalOrderId");

-- AddForeignKey
ALTER TABLE "RentalLateFeeWaiver" ADD CONSTRAINT "RentalLateFeeWaiver_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

