-- Round 25F E: independent approval for high-risk stock decreases and
-- payment reversals; an independent review of manual non-cash confirmations.
-- Expand-only: three new tables, no change to existing tables or data.

-- CreateTable
CREATE TABLE "InventoryAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockAtRequest" INTEGER NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "paymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReversalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualPaymentReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "paymentId" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPaymentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAdjustmentRequest_tenantId_status_idx" ON "InventoryAdjustmentRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "InventoryAdjustmentRequest_variantId_idx" ON "InventoryAdjustmentRequest"("variantId");

-- CreateIndex
CREATE INDEX "PaymentReversalRequest_tenantId_status_idx" ON "PaymentReversalRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentReversalRequest_paymentId_idx" ON "PaymentReversalRequest"("paymentId");

-- CreateIndex
CREATE INDEX "ManualPaymentReview_tenantId_idx" ON "ManualPaymentReview"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualPaymentReview_paymentId_key" ON "ManualPaymentReview"("paymentId");

-- Defence in depth: "a different person" is also a database rule.
ALTER TABLE "InventoryAdjustmentRequest" ADD CONSTRAINT "InventoryAdjustmentRequest_independent_decider"
  CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById" OR status = 'WITHDRAWN');
ALTER TABLE "PaymentReversalRequest" ADD CONSTRAINT "PaymentReversalRequest_independent_decider"
  CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById" OR status IN ('WITHDRAWN', 'EXPIRED'));
ALTER TABLE "ManualPaymentReview" ADD CONSTRAINT "ManualPaymentReview_independent_reviewer"
  CHECK ("reviewedById" <> "confirmedById");
