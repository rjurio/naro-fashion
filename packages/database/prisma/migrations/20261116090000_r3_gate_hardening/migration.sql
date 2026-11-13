-- R3 database gate hardening (round 25C, C). Expand-only: one new table,
-- replaced trigger functions, new immutability triggers. No data changes.
--
-- Before: the gate trusted a transaction-local flag naming the rental. Any
-- caller holding the application's database credentials could set it.
-- Now:
--  1. The declaration must name the rental AND the current transaction id
--     ("<rentalId>:<txid>:<actorId>"): no replay in a later transaction, no
--     leak through a pooled connection, no reuse for another booking.
--  2. Even with a valid declaration the database re-checks the checklist
--     FACTS itself (snapshot, hand-over evidence on the booking's gown,
--     approved exceptions not decided by the actor, return inspection, open
--     discrepancies, "deducted" before keeping deposit money). A forged flag
--     on an incomplete checklist is refused.
--  3. Evidence is immutable in the database: checklist records, snapshots and
--     snapshot items can't be updated or deleted; exceptions, discrepancies
--     and overrides only allow their forward decision transitions.
--  4. Owner-authorised recovery: a single-use, expiring, reasoned row in
--     "RentalGateOverride" (see GATE_RECOVERY_PROCEDURE.md). Its use is
--     stamped (usedAt, usedTxid) and the row can never be changed or removed.
-- Limitation (documented): the role that OWNS these tables can still disable
-- or drop triggers. Closing that needs the application to connect with a
-- non-owner role (proposal in R3_DB_GATE_SECURITY.md).

-- CreateTable
CREATE TABLE "RentalGateOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "rentalOrderId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorizedBy" TEXT NOT NULL,
    "dbUser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedTxid" TEXT,

    CONSTRAINT "RentalGateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalGateOverride_tenantId_idx" ON "RentalGateOverride"("tenantId");

-- CreateIndex
CREATE INDEX "RentalGateOverride_rentalOrderId_step_idx" ON "RentalGateOverride"("rentalOrderId", "step");

-- AddForeignKey
ALTER TABLE "RentalGateOverride" ADD CONSTRAINT "RentalGateOverride_rentalOrderId_fkey" FOREIGN KEY ("rentalOrderId") REFERENCES "RentalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- helpers
-- The declaration for this step, if it names this rental and THIS transaction.
-- Returns the declared actor id ('' when none) or NULL when not declared.
CREATE OR REPLACE FUNCTION naro_r3_declared(p_step text, p_rental text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; parts text[];
BEGIN
  v := current_setting('naro.r3_' || p_step, true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  parts := string_to_array(v, ':');
  IF array_length(parts, 1) < 2 OR parts[1] <> p_rental OR parts[2] <> txid_current()::text THEN RETURN NULL; END IF;
  RETURN coalesce(parts[3], '');
END $$;

-- Consume one unused, unexpired owner override for (rental, step). Single use.
CREATE OR REPLACE FUNCTION naro_r3_use_override(p_step text, p_rental text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE o_id text;
BEGIN
  SELECT id INTO o_id FROM "RentalGateOverride"
   WHERE "rentalOrderId" = p_rental AND step = p_step AND "usedAt" IS NULL AND "expiresAt" > (now() AT TIME ZONE 'UTC')
   ORDER BY "createdAt" LIMIT 1 FOR UPDATE;
  IF o_id IS NULL THEN RETURN false; END IF;
  UPDATE "RentalGateOverride" SET "usedAt" = (now() AT TIME ZONE 'UTC'), "usedTxid" = txid_current()::text WHERE id = o_id;
  RETURN true;
END $$;

-- What the customer must bring back for one snapshot item (mirrors
-- checklistState.expectedReturn): the quantity recorded at hand-over on the
-- booking's gown; 0 when an approved MISSING exception covered it and nothing
-- was recorded; otherwise the listed quantity.
CREATE OR REPLACE FUNCTION naro_r3_expected_return(p_item text, p_rental text, p_unit text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i record; h integer;
BEGIN
  SELECT stage, quantity INTO i FROM "RentalChecklistSnapshotItem" WHERE id = p_item;
  IF i.stage = 'RETURN' THEN RETURN i.quantity; END IF;
  SELECT r.quantity INTO h FROM "RentalChecklistRecord" r
   WHERE r."snapshotItemId" = p_item AND r.stage = 'HANDOVER' AND r."rentalUnitId" IS NOT DISTINCT FROM p_unit
     AND NOT EXISTS (SELECT 1 FROM "RentalChecklistRecord" r2 WHERE r2."supersedesId" = r.id)
   ORDER BY r."recordedAt" DESC LIMIT 1;
  IF h IS NOT NULL THEN RETURN h; END IF;
  IF EXISTS (SELECT 1 FROM "RentalChecklistException" e WHERE e."rentalOrderId" = p_rental AND e.kind = 'MISSING'
             AND e.status IN ('APPROVED', 'USED') AND p_item = ANY (e."snapshotItemIds")) THEN RETURN 0; END IF;
  RETURN i.quantity;
END $$;

-- NULL when the hand-over may happen, else a description of what is missing.
CREATE OR REPLACE FUNCTION naro_r3_handover_problem(p_rental text, p_unit text, p_actor text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s_id text; n integer; missing text; nosnap boolean;
BEGIN
  nosnap := EXISTS (SELECT 1 FROM "RentalChecklistException" e WHERE e."rentalOrderId" = p_rental AND e.kind = 'NO_SNAPSHOT'
                    AND e.status = 'APPROVED' AND (p_actor = '' OR e."decidedById" IS DISTINCT FROM p_actor));
  SELECT id INTO s_id FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = p_rental;
  IF s_id IS NULL THEN RETURN CASE WHEN nosnap THEN NULL ELSE 'no checklist snapshot' END; END IF;
  SELECT count(*) INTO n FROM "RentalChecklistSnapshotItem" WHERE "snapshotId" = s_id;
  IF n = 0 THEN RETURN CASE WHEN nosnap THEN NULL ELSE 'empty checklist' END; END IF;
  SELECT string_agg(i.label, ', ' ORDER BY i."sortOrder") INTO missing
    FROM "RentalChecklistSnapshotItem" i
   WHERE i."snapshotId" = s_id AND i.stage = 'BOTH' AND i."isMandatory"
     AND NOT EXISTS (
       SELECT 1 FROM "RentalChecklistRecord" r
        WHERE r."snapshotItemId" = i.id AND r.stage = 'HANDOVER' AND r."rentalUnitId" IS NOT DISTINCT FROM p_unit
          AND NOT EXISTS (SELECT 1 FROM "RentalChecklistRecord" r2 WHERE r2."supersedesId" = r.id)
          AND r.quantity >= i.quantity
          AND (NOT i."requiresCondition" OR (r.condition IS NOT NULL AND r.condition <> 'MISSING')))
     AND NOT EXISTS (
       SELECT 1 FROM "RentalChecklistException" e
        WHERE e."rentalOrderId" = p_rental AND e.status = 'APPROVED' AND i.id = ANY (e."snapshotItemIds")
          AND (p_actor = '' OR e."decidedById" IS DISTINCT FROM p_actor));
  RETURN CASE WHEN missing IS NULL THEN NULL ELSE 'unchecked: ' || missing END;
END $$;

-- NULL when the return inspection is complete and nothing is OPEN.
CREATE OR REPLACE FUNCTION naro_r3_inspection_problem(p_rental text, p_unit text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s_id text; missing text; open_n integer;
BEGIN
  SELECT id INTO s_id FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = p_rental;
  IF s_id IS NULL THEN RETURN 'no checklist snapshot'; END IF;
  SELECT string_agg(i.label, ', ' ORDER BY i."sortOrder") INTO missing
    FROM "RentalChecklistSnapshotItem" i
   WHERE i."snapshotId" = s_id AND naro_r3_expected_return(i.id, p_rental, p_unit) > 0
     AND NOT EXISTS (
       SELECT 1 FROM "RentalChecklistRecord" r
        WHERE r."snapshotItemId" = i.id AND r.stage = 'RETURN'
          AND NOT EXISTS (SELECT 1 FROM "RentalChecklistRecord" r2 WHERE r2."supersedesId" = r.id));
  IF missing IS NOT NULL THEN RETURN 'not inspected: ' || missing; END IF;
  SELECT count(*) INTO open_n FROM "RentalDiscrepancy" WHERE "rentalOrderId" = p_rental AND status = 'OPEN';
  IF open_n > 0 THEN RETURN open_n || ' open discrepancy(ies)'; END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------- gates
CREATE OR REPLACE FUNCTION naro_r3_rental_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text; problem text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('ITEM_DISPATCHED', 'ACTIVE')
       AND OLD.status NOT IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED') THEN
      actor := naro_r3_declared('handover', NEW.id);
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE naro_r3_handover_problem(NEW.id, NEW."rentalUnitId", actor) END;
      IF problem IS NOT NULL AND NOT naro_r3_use_override('handover', NEW.id) THEN
        RAISE EXCEPTION 'R3_CHECKLIST_GATE: hand-over of rental % refused (%)', NEW.id, problem USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.status = 'CLOSED' THEN
      actor := naro_r3_declared('close', NEW.id);
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE naro_r3_inspection_problem(NEW.id, NEW."rentalUnitId") END;
      IF problem IS NOT NULL AND NOT naro_r3_use_override('close', NEW.id) THEN
        RAISE EXCEPTION 'R3_CHECKLIST_GATE: closing rental % refused (%)', NEW.id, problem USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION naro_r3_deposit_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; actor text; problem text;
BEGIN
  IF NEW.kind = 'DEPOSIT_RETURN' AND NEW."rentalOrderId" IS NOT NULL THEN
    SELECT id, status, "rentalUnitId" INTO r FROM "RentalOrder" WHERE id = NEW."rentalOrderId";
    IF r.status IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED') THEN
      actor := naro_r3_declared('deposit', NEW."rentalOrderId");
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE naro_r3_inspection_problem(r.id, r."rentalUnitId") END;
      IF problem IS NULL AND COALESCE(NEW."retainedAmount", 0) > 0
         AND NOT EXISTS (SELECT 1 FROM "RentalDiscrepancy" d WHERE d."rentalOrderId" = r.id AND d.status = 'RESOLVED_DEDUCTED') THEN
        problem := 'deposit kept without a discrepancy resolved as deducted';
      END IF;
      IF problem IS NOT NULL AND NOT naro_r3_use_override('deposit', NEW."rentalOrderId") THEN
        RAISE EXCEPTION 'R3_CHECKLIST_GATE: deposit return for rental % refused (%)', NEW."rentalOrderId", problem USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION naro_r3_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: % rows can''t be changed or removed', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER naro_r3_record_immutable BEFORE UPDATE OR DELETE ON "RentalChecklistRecord" FOR EACH ROW EXECUTE FUNCTION naro_r3_immutable();
CREATE TRIGGER naro_r3_record_no_truncate BEFORE TRUNCATE ON "RentalChecklistRecord" FOR EACH STATEMENT EXECUTE FUNCTION naro_r3_immutable();
CREATE TRIGGER naro_r3_snapshot_immutable BEFORE UPDATE OR DELETE ON "RentalChecklistSnapshot" FOR EACH ROW EXECUTE FUNCTION naro_r3_immutable();
CREATE TRIGGER naro_r3_snapshot_no_truncate BEFORE TRUNCATE ON "RentalChecklistSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION naro_r3_immutable();
CREATE TRIGGER naro_r3_snapshot_item_immutable BEFORE UPDATE OR DELETE ON "RentalChecklistSnapshotItem" FOR EACH ROW EXECUTE FUNCTION naro_r3_immutable();
CREATE TRIGGER naro_r3_snapshot_item_no_truncate BEFORE TRUNCATE ON "RentalChecklistSnapshotItem" FOR EACH STATEMENT EXECUTE FUNCTION naro_r3_immutable();

-- Exceptions: REQUESTED -> APPROVED | REJECTED (decision fields), APPROVED -> USED (use fields). Nothing else.
CREATE OR REPLACE FUNCTION naro_r3_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: checklist exceptions can''t be removed' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW."tenantId", NEW."rentalOrderId", NEW.kind, NEW."snapshotItemIds", NEW."substituteNote", NEW.reason, NEW."requestedById", NEW."createdAt")
     IS DISTINCT FROM (OLD.id, OLD."tenantId", OLD."rentalOrderId", OLD.kind, OLD."snapshotItemIds", OLD."substituteNote", OLD.reason, OLD."requestedById", OLD."createdAt")
     OR NOT ((OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED') AND NEW."decidedById" IS NOT NULL
              AND NEW."usedById" IS NULL AND NEW."usedAt" IS NULL)
          OR (OLD.status = 'APPROVED' AND NEW.status = 'USED'
              AND (NEW."decidedById", NEW."decidedAt", NEW."decisionNote") IS NOT DISTINCT FROM (OLD."decidedById", OLD."decidedAt", OLD."decisionNote"))) THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: checklist exception % may only move forward (% -> %)', OLD.id, OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_exception_guard BEFORE UPDATE OR DELETE ON "RentalChecklistException" FOR EACH ROW EXECUTE FUNCTION naro_r3_exception_guard();

-- Discrepancies: OPEN -> RESOLVED_* (with who/when/note) or SUPERSEDED. Facts never change.
CREATE OR REPLACE FUNCTION naro_r3_discrepancy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: discrepancies can''t be removed' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.id, NEW."tenantId", NEW."rentalOrderId", NEW."snapshotItemId", NEW."recordId", NEW.kind, NEW.quantity, NEW.note, NEW."openedAt")
     IS DISTINCT FROM (OLD.id, OLD."tenantId", OLD."rentalOrderId", OLD."snapshotItemId", OLD."recordId", OLD.kind, OLD.quantity, OLD.note, OLD."openedAt")
     OR NOT (OLD.status = 'OPEN' AND (
              (NEW.status IN ('RESOLVED_NO_CHARGE', 'RESOLVED_DEDUCTED', 'RESOLVED_WAIVED') AND NEW."resolvedById" IS NOT NULL AND NEW."resolvedAt" IS NOT NULL)
           OR (NEW.status = 'SUPERSEDED' AND NEW."resolvedById" IS NULL))) THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: discrepancy % may only be decided once (% -> %)', OLD.id, OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_discrepancy_guard BEFORE UPDATE OR DELETE ON "RentalDiscrepancy" FOR EACH ROW EXECUTE FUNCTION naro_r3_discrepancy_guard();

-- Overrides: validated on insert (reason, authoriser, short expiry, known
-- rental, valid step; the database user is recorded); only "used" can be set,
-- once; never removed.
CREATE OR REPLACE FUNCTION naro_r3_override_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: gate overrides can''t be removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.step NOT IN ('handover', 'close', 'deposit') THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: step must be handover, close or deposit'; END IF;
    IF length(btrim(NEW.reason)) < 20 THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: a reason of at least 20 characters is required'; END IF;
    IF length(btrim(NEW."authorizedBy")) < 3 THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: name the owner who authorised it'; END IF;
    -- Timestamps are UTC (as the application stores them), whatever the session time zone.
    IF NEW."expiresAt" > (now() AT TIME ZONE 'UTC') + interval '60 minutes' OR NEW."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'R3_OVERRIDE_INVALID: an override must expire within 60 minutes';
    END IF;
    IF NEW."usedAt" IS NOT NULL OR NEW."usedTxid" IS NOT NULL THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: a new override is unused'; END IF;
    NEW."dbUser" := session_user;
    NEW."createdAt" := (now() AT TIME ZONE 'UTC');
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW."tenantId", NEW."rentalOrderId", NEW.step, NEW.reason, NEW."authorizedBy", NEW."dbUser", NEW."createdAt", NEW."expiresAt")
     IS DISTINCT FROM (OLD.id, OLD."tenantId", OLD."rentalOrderId", OLD.step, OLD.reason, OLD."authorizedBy", OLD."dbUser", OLD."createdAt", OLD."expiresAt")
     OR OLD."usedAt" IS NOT NULL OR NEW."usedAt" IS NULL OR NEW."usedTxid" IS NULL THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: gate override % can only be consumed once', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_override_guard BEFORE INSERT OR UPDATE OR DELETE ON "RentalGateOverride" FOR EACH ROW EXECUTE FUNCTION naro_r3_override_guard();
