-- R3 mandatory rental checklist (expand-only). Template scope + item rules;
-- per-booking snapshot (frozen at confirmation); append-only records;
-- independently approved exceptions; per-item discrepancies (facts, no
-- amounts). The table "RentalChecklistSnapshot" is also the R1 rollback
-- marker: once it exists, older builds refuse every hand-over. Existing
-- bookings are untouched (backfill is a separate, audited step).

-- AlterTable
ALTER TABLE "RentalChecklistTemplate" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RentalChecklistTemplateItem" ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "isMandatory" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requiresCondition" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RentalChecklistSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "source" TEXT NOT NULL,
    "rentalUnitId" TEXT,
    "unitCode" TEXT,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenById" TEXT,

    CONSTRAINT "RentalChecklistSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalChecklistSnapshotItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "snapshotId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelSwahili" TEXT,
    "stage" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "isMandatory" BOOLEAN NOT NULL,
    "requiresCondition" BOOLEAN NOT NULL,
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "templateItemId" TEXT,

    CONSTRAINT "RentalChecklistSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalChecklistRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "snapshotItemId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" TEXT,
    "rentalUnitId" TEXT,

    CONSTRAINT "RentalChecklistRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalChecklistException" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "snapshotItemIds" TEXT[],
    "substituteNote" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalChecklistException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDiscrepancy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "snapshotItemId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalChecklistSnapshot_rentalOrderId_key" ON "RentalChecklistSnapshot"("rentalOrderId");

-- CreateIndex
CREATE INDEX "RentalChecklistSnapshot_tenantId_idx" ON "RentalChecklistSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "RentalChecklistSnapshotItem_tenantId_idx" ON "RentalChecklistSnapshotItem"("tenantId");

-- CreateIndex
CREATE INDEX "RentalChecklistSnapshotItem_snapshotId_idx" ON "RentalChecklistSnapshotItem"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalChecklistRecord_supersedesId_key" ON "RentalChecklistRecord"("supersedesId");

-- CreateIndex
CREATE INDEX "RentalChecklistRecord_tenantId_idx" ON "RentalChecklistRecord"("tenantId");

-- CreateIndex
CREATE INDEX "RentalChecklistRecord_rentalOrderId_stage_idx" ON "RentalChecklistRecord"("rentalOrderId", "stage");

-- CreateIndex
CREATE INDEX "RentalChecklistRecord_snapshotItemId_stage_idx" ON "RentalChecklistRecord"("snapshotItemId", "stage");

-- CreateIndex
CREATE INDEX "RentalChecklistException_tenantId_idx" ON "RentalChecklistException"("tenantId");

-- CreateIndex
CREATE INDEX "RentalChecklistException_rentalOrderId_idx" ON "RentalChecklistException"("rentalOrderId");

-- CreateIndex
CREATE INDEX "RentalDiscrepancy_tenantId_idx" ON "RentalDiscrepancy"("tenantId");

-- CreateIndex
CREATE INDEX "RentalDiscrepancy_rentalOrderId_status_idx" ON "RentalDiscrepancy"("rentalOrderId", "status");

-- CreateIndex
CREATE INDEX "RentalChecklistTemplate_productId_idx" ON "RentalChecklistTemplate"("productId");

-- CreateIndex
CREATE INDEX "RentalChecklistTemplate_categoryId_idx" ON "RentalChecklistTemplate"("categoryId");

-- AddForeignKey
ALTER TABLE "RentalChecklistSnapshot" ADD CONSTRAINT "RentalChecklistSnapshot_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalChecklistSnapshotItem" ADD CONSTRAINT "RentalChecklistSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RentalChecklistSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalChecklistRecord" ADD CONSTRAINT "RentalChecklistRecord_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalChecklistRecord" ADD CONSTRAINT "RentalChecklistRecord_snapshotItemId_fkey" FOREIGN KEY ("snapshotItemId") REFERENCES "RentalChecklistSnapshotItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalChecklistException" ADD CONSTRAINT "RentalChecklistException_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalDiscrepancy" ADD CONSTRAINT "RentalDiscrepancy_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Fail-closed rollback protection (R3 plan, owner requirement F). Enforced by
-- the DATABASE, so it holds for every application build, including builds
-- older than the R1 safety switch: once this migration has run, a rental can
-- be handed over (-> ITEM_DISPATCHED / ACTIVE), closed (-> CLOSED), or have a
-- deposit return requested after hand-over ONLY inside a transaction where
-- the R3 checklist gate has just passed and declared it with
-- set_config('naro.r3_<step>', <rental id>, true). The setting is
-- transaction-local and names one rental, so it can't leak to another
-- booking or another request. A build without the R3 gate never sets it and
-- the write is refused. Prisma does not track triggers: schema diffs ignore
-- them. Never drop these without the owner's written authorisation.
-- ============================================================================
CREATE OR REPLACE FUNCTION naro_r3_rental_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('ITEM_DISPATCHED', 'ACTIVE')
       AND OLD.status NOT IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED')
       AND coalesce(current_setting('naro.r3_handover', true), '') <> NEW.id THEN
      RAISE EXCEPTION 'R3_CHECKLIST_GATE: rental % can only be handed over through the checklist gate', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'CLOSED'
       AND coalesce(current_setting('naro.r3_close', true), '') <> NEW.id THEN
      RAISE EXCEPTION 'R3_CHECKLIST_GATE: rental % can only be closed after the return inspection', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER naro_r3_rental_gate
  BEFORE UPDATE OF status ON "RentalOrder"
  FOR EACH ROW EXECUTE FUNCTION naro_r3_rental_gate();

CREATE OR REPLACE FUNCTION naro_r3_deposit_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'DEPOSIT_RETURN'
     AND NEW."rentalOrderId" IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM "RentalOrder" r
       WHERE r.id = NEW."rentalOrderId"
         AND r.status IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED')
     )
     AND coalesce(current_setting('naro.r3_deposit', true), '') <> NEW."rentalOrderId" THEN
    RAISE EXCEPTION 'R3_CHECKLIST_GATE: the deposit of rental % can only be settled after the return inspection', NEW."rentalOrderId"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER naro_r3_deposit_gate
  BEFORE INSERT ON "RentalRefundRequest"
  FOR EACH ROW EXECUTE FUNCTION naro_r3_deposit_gate();
