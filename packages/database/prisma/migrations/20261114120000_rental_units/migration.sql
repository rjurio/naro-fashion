-- Expand-only (POS rental MVP, phase M2: physical rental units). Three new
-- tables + nullable RentalOrder columns. No existing row is changed: products
-- without units keep the legacy one-booking-at-a-time rule.
-- AlterTable
ALTER TABLE "RentalOrder" ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverByAdminId" TEXT,
ADD COLUMN     "rentalUnitId" TEXT,
ADD COLUMN     "returnCondition" TEXT,
ADD COLUMN     "returnNotes" TEXT,
ADD COLUMN     "returnedByAdminId" TEXT;

-- CreateTable
CREATE TABLE "RentalUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "conditionNotes" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalUnitVariant" (
    "unitId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,

    CONSTRAINT "RentalUnitVariant_pkey" PRIMARY KEY ("unitId","variantId")
);

-- CreateTable
CREATE TABLE "RentalUnitBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "unitId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalUnitBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalUnit_tenantId_idx" ON "RentalUnit"("tenantId");

-- CreateIndex
CREATE INDEX "RentalUnit_productId_idx" ON "RentalUnit"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalUnit_tenantId_code_key" ON "RentalUnit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RentalUnitVariant_variantId_idx" ON "RentalUnitVariant"("variantId");

-- CreateIndex
CREATE INDEX "RentalUnitBlock_tenantId_idx" ON "RentalUnitBlock"("tenantId");

-- CreateIndex
CREATE INDEX "RentalUnitBlock_unitId_idx" ON "RentalUnitBlock"("unitId");

-- CreateIndex
CREATE INDEX "RentalOrder_rentalUnitId_idx" ON "RentalOrder"("rentalUnitId");

-- AddForeignKey
ALTER TABLE "RentalOrder" ADD CONSTRAINT "RentalOrder_rentalUnitId_fkey" FOREIGN KEY ("rentalUnitId") REFERENCES "RentalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalUnit" ADD CONSTRAINT "RentalUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalUnitVariant" ADD CONSTRAINT "RentalUnitVariant_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RentalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalUnitVariant" ADD CONSTRAINT "RentalUnitVariant_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalUnitBlock" ADD CONSTRAINT "RentalUnitBlock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RentalUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

