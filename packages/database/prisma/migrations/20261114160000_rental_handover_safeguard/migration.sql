-- R1 rollback safety switch (expand-only): a per-shop flag R3 sets; builds
-- without the checklist gate refuse every rental hand-over while it is on.

-- CreateTable
CREATE TABLE "RentalHandoverSafeguard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "checklistRequired" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalHandoverSafeguard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalHandoverSafeguard_tenantId_key" ON "RentalHandoverSafeguard"("tenantId");

