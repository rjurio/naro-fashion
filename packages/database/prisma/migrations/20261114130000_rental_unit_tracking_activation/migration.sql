-- POS rental MVP (R2): per-gown availability only after an independently
-- approved physical count. Expand-only: nullable columns + one new table.
-- Until a product is activated, availability keeps the legacy rule.
ALTER TABLE "Product" ADD COLUMN "rentalUnitTrackingActivatedAt" TIMESTAMP(3);
ALTER TABLE "RentalUnit" ADD COLUMN "trackingVerifiedAt" TIMESTAMP(3);

CREATE TABLE "RentalUnitTrackingChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "productId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "countedQuantity" INTEGER,
    "unitIds" TEXT[],
    "unitSetHash" TEXT,
    "plan" JSONB,
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalUnitTrackingChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RentalUnitTrackingChange_tenantId_idx" ON "RentalUnitTrackingChange"("tenantId");
CREATE INDEX "RentalUnitTrackingChange_productId_status_idx" ON "RentalUnitTrackingChange"("productId", "status");

ALTER TABLE "RentalUnitTrackingChange" ADD CONSTRAINT "RentalUnitTrackingChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
