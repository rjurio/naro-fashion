-- Expand-only (POS rental MVP, phase M1: rental money ledger). New nullable
-- Payment columns + RentalOrder columns (channel defaults to ONLINE) + the
-- RentalRefundRequest table. No existing row is rewritten: legacy payments
-- keep component NULL (= unallocated, see apps/api/src/rentals/rental-ledger.ts).
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "component" TEXT,
ADD COLUMN     "refundOfPaymentId" TEXT,
ADD COLUMN     "refundRequestId" TEXT;

-- AlterTable
ALTER TABLE "RentalOrder" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "createdByAdminId" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RentalRefundRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "retainedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "payoutMethod" TEXT,
    "payoutReference" TEXT,
    "failedById" TEXT,
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalRefundRequest_tenantId_idx" ON "RentalRefundRequest"("tenantId");

-- CreateIndex
CREATE INDEX "RentalRefundRequest_rentalOrderId_idx" ON "RentalRefundRequest"("rentalOrderId");

-- CreateIndex
CREATE INDEX "RentalRefundRequest_status_idx" ON "RentalRefundRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RentalRefundRequest_tenantId_payoutReference_key" ON "RentalRefundRequest"("tenantId", "payoutReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_refundRequestId_key" ON "Payment"("refundRequestId");

-- CreateIndex
CREATE INDEX "Payment_refundOfPaymentId_idx" ON "Payment"("refundOfPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundOfPaymentId_fkey" FOREIGN KEY ("refundOfPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RentalRefundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalRefundRequest" ADD CONSTRAINT "RentalRefundRequest_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

