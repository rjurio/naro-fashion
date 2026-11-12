-- R1b unified refund workflow: ONE request -> independent approval -> recorded
-- payout for rentals, online orders, POS sales / exchanges and layaways.
-- Expand-only: new nullable columns + relaxed NOT NULLs + indexes + FKs.
-- The table keeps its name (Prisma model RefundRequest @@map). Code from
-- before this migration keeps working (it always sets rentalOrderId/component).

-- AlterTable
ALTER TABLE "Layaway" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledByAdminId" TEXT,
ADD COLUMN     "financialDisposition" TEXT;

-- AlterTable
ALTER TABLE "RentalRefundRequest" ADD COLUMN     "exchangeNumber" TEXT,
ADD COLUMN     "layawayId" TEXT,
ADD COLUMN     "lines" JSONB,
ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "retryOfId" TEXT,
ADD COLUMN     "subject" TEXT NOT NULL DEFAULT 'RENTAL',
ALTER COLUMN "rentalOrderId" DROP NOT NULL,
ALTER COLUMN "component" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "RentalRefundRequest_orderId_idx" ON "RentalRefundRequest"("orderId");

-- CreateIndex
CREATE INDEX "RentalRefundRequest_layawayId_idx" ON "RentalRefundRequest"("layawayId");

-- CreateIndex
CREATE INDEX "RentalRefundRequest_subject_status_idx" ON "RentalRefundRequest"("subject", "status");

-- AddForeignKey
ALTER TABLE "RentalRefundRequest" ADD CONSTRAINT "RentalRefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalRefundRequest" ADD CONSTRAINT "RentalRefundRequest_layawayId_fkey" FOREIGN KEY ("layawayId") REFERENCES "Layaway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

