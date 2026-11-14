-- R3 trusted database controls (round 25D, B). Expand-only: no table or
-- column changes, no data changes. Replaces the R3 gate functions and adds
-- guards, so that the hand-over gate does not rest on anything the
-- application merely ASSERTS:
--
--  1. Release facts re-checked by the database at hand-over (mirrors
--     RentalsService.assertReleasable): an APPROVED national ID of the
--     booking's customer in the same shop, the full rental fee and the full
--     deposit actually received (COMPLETED payments of the same shop, the
--     ledger's allocation order fee -> deposit -> late fee), a delivery
--     address, and, for products whose gown tracking is activated, an ACTIVE
--     verified gown of the same shop.
--  2. The declared staff member is verified, not trusted: an active,
--     non-deleted admin of the booking's shop (or an active platform admin),
--     who holds "rentals:release" for a hand-over (SUPER_ADMIN holds every
--     permission, as in PermissionGuard). An empty or unknown actor is refused.
--  3. Exceptions: created only as REQUESTED by a real staff member of the
--     shop; decided only by a different, authorised person
--     ("rentals:checklist-exception"). Discrepancies: decided by an authorised
--     person other than the one who recorded the return. Checklist records:
--     recorded by an authorised staff member ("rentals:checklist-verify") of
--     the booking's shop, for an item of that booking's snapshot.
--  4. Money the gate relies on can't be rewritten: a rental payment can't be
--     moved to another booking or shop; once COMPLETED / REFUNDED / REVERSED
--     its amount, component, method and links are frozen, it only moves
--     COMPLETED -> REVERSED or REFUNDED -> REVERSED, and it is never deleted.
--     A booking's shop, customer, product, fee and deposit never change.
--  5. Recovery overrides can only be CREATED by the role that owns the tables
--     (the migration / owner role) or a superuser - never by a runtime role,
--     even if INSERT were granted to it by mistake.
--  6. Every naro_r3_* function is SECURITY DEFINER with a fixed search_path
--     (this schema, then pg_temp last) and EXECUTE revoked from PUBLIC: a
--     runtime role can neither call them directly (e.g. to burn an override)
--     nor shadow the tables they read.
--
-- With role separation (scripts/ops/db-roles/) the runtime role also can't
-- disable, drop or replace any of this. Without it (today: the application
-- connects as the owner) points 1-4 still hold for any code path, but an
-- owner can always ALTER TABLE ... DISABLE TRIGGER.

-- ---------------------------------------------------------------- staff check
-- NULL when p_actor is an active staff member of p_tenant holding p_perm
-- (p_perm NULL: any active staff member); else the reason.
CREATE OR REPLACE FUNCTION naro_r3_staff_problem(p_tenant text, p_actor text, p_perm text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE a record;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN RETURN 'no staff member named'; END IF;
  SELECT id, "tenantId", role, "isActive", "deletedAt" INTO a FROM "AdminUser" WHERE id = p_actor;
  IF a.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM "PlatformAdmin" pa WHERE pa.id = p_actor AND pa."isActive") THEN RETURN NULL; END IF;
    RETURN 'staff member ' || p_actor || ' unknown';
  END IF;
  IF NOT a."isActive" OR a."deletedAt" IS NOT NULL THEN RETURN 'staff member ' || p_actor || ' is not active'; END IF;
  IF a."tenantId" IS DISTINCT FROM p_tenant THEN RETURN 'staff member ' || p_actor || ' belongs to another shop'; END IF;
  IF p_perm IS NULL OR a.role = 'SUPER_ADMIN' THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM "AdminUserRole" ur
      JOIN "Role" r ON r.id = ur."roleId" AND r."deletedAt" IS NULL AND r."isActive"
                   AND (r."tenantId" = p_tenant OR (r."tenantId" IS NULL AND r."isSystem"))
      JOIN "RolePermission" rp ON rp."roleId" = r.id
      JOIN "Permission" p ON p.id = rp."permissionId" AND p.code = p_perm
     WHERE ur."adminUserId" = p_actor) THEN RETURN NULL; END IF;
  RETURN 'staff member ' || p_actor || ' lacks ' || p_perm;
END $$;

-- ---------------------------------------------------------------- release facts
-- NULL when the booking may leave the shop (ID, money, address, gown); else
-- what is missing. Mirrors RentalsService.assertReleasable + rentalBalances.
CREATE OR REPLACE FUNCTION naro_r3_release_problem(p_rental text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE r record; fee_c numeric; dep_c numeric; un numeric; take numeric; missing text[] := '{}'; activated timestamp; u record;
BEGIN
  SELECT id, "tenantId", "userId", "productId", "rentalUnitId", "totalRentalPrice", "damageDeposit" INTO r
    FROM "RentalOrder" WHERE id = p_rental;
  IF r.id IS NULL THEN RETURN 'unknown rental'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "CustomerIDDocument" d WHERE d."tenantId" = r."tenantId" AND d."userId" = r."userId"
                 AND d."verificationStatus" = 'APPROVED') THEN missing := array_append(missing, 'APPROVED_ID'); END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE component = 'RENTAL_FEE'), 0),
         COALESCE(sum(amount) FILTER (WHERE component = 'DEPOSIT'), 0),
         COALESCE(sum(amount) FILTER (WHERE component IS NULL OR component NOT IN ('RENTAL_FEE', 'DEPOSIT', 'LATE_FEE')), 0)
    INTO fee_c, dep_c, un
    FROM "Payment" WHERE "rentalOrderId" = r.id AND "tenantId" = r."tenantId" AND status = 'COMPLETED';
  take := LEAST(GREATEST(0, GREATEST(0, r."totalRentalPrice") - fee_c), un); fee_c := fee_c + take; un := un - take;
  take := LEAST(GREATEST(0, GREATEST(0, r."damageDeposit") - dep_c), un); dep_c := dep_c + take;
  IF fee_c < GREATEST(0, r."totalRentalPrice") THEN missing := array_append(missing, 'FULL_RENTAL_FEE'); END IF;
  IF dep_c < GREATEST(0, r."damageDeposit") THEN missing := array_append(missing, 'DEPOSIT'); END IF;
  IF NOT EXISTS (SELECT 1 FROM "Address" a WHERE a."userId" = r."userId") THEN missing := array_append(missing, 'ADDRESS'); END IF;
  SELECT p."rentalUnitTrackingActivatedAt" INTO activated FROM "Product" p WHERE p.id = r."productId" AND p."tenantId" = r."tenantId";
  IF activated IS NOT NULL THEN
    SELECT status, "trackingVerifiedAt" INTO u FROM "RentalUnit" WHERE id = r."rentalUnitId" AND "tenantId" = r."tenantId";
    IF u.status IS DISTINCT FROM 'ACTIVE' OR u."trackingVerifiedAt" IS NULL THEN missing := array_append(missing, 'UNIT'); END IF;
  END IF;
  RETURN CASE WHEN cardinality(missing) = 0 THEN NULL ELSE 'release requirements missing: ' || array_to_string(missing, ', ') END;
END $$;

-- ---------------------------------------------------------------- gates (replaced)
CREATE OR REPLACE FUNCTION naro_r3_rental_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text; problem text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('ITEM_DISPATCHED', 'ACTIVE')
       AND OLD.status NOT IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED') THEN
      actor := naro_r3_declared('handover', NEW.id);
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE NULLIF(concat_ws('; ', naro_r3_staff_problem(NEW."tenantId", actor, 'rentals:release'),
                                                  naro_r3_handover_problem(NEW.id, NEW."rentalUnitId", actor),
                                                  naro_r3_release_problem(NEW.id)), '') END;
      IF problem IS NOT NULL AND NOT naro_r3_use_override('handover', NEW.id) THEN
        RAISE EXCEPTION 'R3_CHECKLIST_GATE: hand-over of rental % refused (%)', NEW.id, problem USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.status = 'CLOSED' THEN
      actor := naro_r3_declared('close', NEW.id);
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE NULLIF(concat_ws('; ', naro_r3_staff_problem(NEW."tenantId", actor, NULL),
                                                  naro_r3_inspection_problem(NEW.id, NEW."rentalUnitId")), '') END;
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
    SELECT id, "tenantId", status, "rentalUnitId" INTO r FROM "RentalOrder" WHERE id = NEW."rentalOrderId";
    IF r.status IN ('ITEM_DISPATCHED', 'ACTIVE', 'RETURNED', 'INSPECTION', 'CLOSED') THEN
      actor := naro_r3_declared('deposit', NEW."rentalOrderId");
      problem := CASE WHEN actor IS NULL THEN 'not declared by the checklist gate in this transaction'
                      ELSE NULLIF(concat_ws('; ', naro_r3_staff_problem(r."tenantId", actor, NULL),
                                                  naro_r3_inspection_problem(r.id, r."rentalUnitId")), '') END;
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

-- ---------------------------------------------------------------- evidence: who and which shop
CREATE OR REPLACE FUNCTION naro_r3_record_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; problem text;
BEGIN
  SELECT o.id, o."tenantId" INTO r FROM "RentalOrder" o
    JOIN "RentalChecklistSnapshot" s ON s."rentalOrderId" = o.id
    JOIN "RentalChecklistSnapshotItem" i ON i."snapshotId" = s.id AND i.id = NEW."snapshotItemId"
   WHERE o.id = NEW."rentalOrderId";
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'R3_EVIDENCE_INVALID: item % is not on the checklist of rental %', NEW."snapshotItemId", NEW."rentalOrderId" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM r."tenantId" THEN
    RAISE EXCEPTION 'R3_EVIDENCE_INVALID: checklist evidence must belong to the booking''s shop' USING ERRCODE = 'P0001';
  END IF;
  problem := naro_r3_staff_problem(r."tenantId", NEW."recordedById", 'rentals:checklist-verify');
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'R3_EVIDENCE_INVALID: checklist evidence refused (%)', problem USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_record_insert_guard BEFORE INSERT ON "RentalChecklistRecord" FOR EACH ROW EXECUTE FUNCTION naro_r3_record_insert_guard();

-- Exceptions: created as REQUESTED by staff of the booking's shop; decided by
-- a different person holding rentals:checklist-exception; then forward only.
CREATE OR REPLACE FUNCTION naro_r3_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; problem text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: checklist exceptions can''t be removed' USING ERRCODE = 'P0001';
  END IF;
  SELECT "tenantId" INTO t FROM "RentalOrder" WHERE id = NEW."rentalOrderId";
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'REQUESTED' OR NEW."decidedById" IS NOT NULL OR NEW."decidedAt" IS NOT NULL
       OR NEW."usedById" IS NOT NULL OR NEW."usedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'R3_EVIDENCE_INVALID: a checklist exception starts as REQUESTED, undecided' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."tenantId" IS DISTINCT FROM t THEN
      RAISE EXCEPTION 'R3_EVIDENCE_INVALID: an exception must belong to the booking''s shop' USING ERRCODE = 'P0001';
    END IF;
    problem := naro_r3_staff_problem(t, NEW."requestedById", 'rentals:checklist-verify');
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'R3_EVIDENCE_INVALID: exception request refused (%)', problem USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW."tenantId", NEW."rentalOrderId", NEW.kind, NEW."snapshotItemIds", NEW."substituteNote", NEW.reason, NEW."requestedById", NEW."createdAt")
     IS DISTINCT FROM (OLD.id, OLD."tenantId", OLD."rentalOrderId", OLD.kind, OLD."snapshotItemIds", OLD."substituteNote", OLD.reason, OLD."requestedById", OLD."createdAt")
     OR NOT ((OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'REJECTED') AND NEW."decidedById" IS NOT NULL
              AND NEW."usedById" IS NULL AND NEW."usedAt" IS NULL)
          OR (OLD.status = 'APPROVED' AND NEW.status = 'USED'
              AND (NEW."decidedById", NEW."decidedAt", NEW."decisionNote") IS NOT DISTINCT FROM (OLD."decidedById", OLD."decidedAt", OLD."decisionNote"))) THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: checklist exception % may only move forward (% -> %)', OLD.id, OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'REQUESTED' THEN
    IF NEW."decidedById" = OLD."requestedById" THEN
      RAISE EXCEPTION 'R3_EVIDENCE_INVALID: exception % must be decided by someone other than the requester', OLD.id USING ERRCODE = 'P0001';
    END IF;
    problem := naro_r3_staff_problem(t, NEW."decidedById", 'rentals:checklist-exception');
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'R3_EVIDENCE_INVALID: exception decision refused (%)', problem USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER naro_r3_exception_guard ON "RentalChecklistException";
CREATE TRIGGER naro_r3_exception_guard BEFORE INSERT OR UPDATE OR DELETE ON "RentalChecklistException" FOR EACH ROW EXECUTE FUNCTION naro_r3_exception_guard();

-- Discrepancies: as before, plus the decider is authorised and isn't the
-- person who recorded the return.
CREATE OR REPLACE FUNCTION naro_r3_discrepancy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; recorder text; problem text;
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
  IF NEW.status <> 'SUPERSEDED' THEN
    SELECT o."tenantId" INTO t FROM "RentalOrder" o WHERE o.id = NEW."rentalOrderId";
    SELECT "recordedById" INTO recorder FROM "RentalChecklistRecord" WHERE id = NEW."recordId";
    IF NEW."resolvedById" = recorder THEN
      RAISE EXCEPTION 'R3_EVIDENCE_INVALID: discrepancy % must be decided by someone other than the person who recorded the return', OLD.id USING ERRCODE = 'P0001';
    END IF;
    problem := naro_r3_staff_problem(t, NEW."resolvedById", 'rentals:checklist-exception');
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'R3_EVIDENCE_INVALID: discrepancy decision refused (%)', problem USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Overrides: as before, plus only the owner role (or a superuser) may create one.
CREATE OR REPLACE FUNCTION naro_r3_override_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_oid oid; t text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R3_EVIDENCE_IMMUTABLE: gate overrides can''t be removed' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT relowner INTO owner_oid FROM pg_class WHERE oid = TG_RELID;
    IF NOT (pg_has_role(session_user, owner_oid, 'MEMBER')
            OR COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = session_user), false)) THEN
      RAISE EXCEPTION 'R3_OVERRIDE_NOT_AUTHORISED: only the database owner role may create a recovery override (connected as %)', session_user USING ERRCODE = 'P0001';
    END IF;
    IF NEW.step NOT IN ('handover', 'close', 'deposit') THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: step must be handover, close or deposit'; END IF;
    IF length(btrim(NEW.reason)) < 20 THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: a reason of at least 20 characters is required'; END IF;
    IF length(btrim(NEW."authorizedBy")) < 3 THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: name the owner who authorised it'; END IF;
    IF NEW."expiresAt" > (now() AT TIME ZONE 'UTC') + interval '60 minutes' OR NEW."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'R3_OVERRIDE_INVALID: an override must expire within 60 minutes';
    END IF;
    IF NEW."usedAt" IS NOT NULL OR NEW."usedTxid" IS NOT NULL THEN RAISE EXCEPTION 'R3_OVERRIDE_INVALID: a new override is unused'; END IF;
    SELECT "tenantId" INTO t FROM "RentalOrder" WHERE id = NEW."rentalOrderId";
    NEW."tenantId" := t;
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

-- ---------------------------------------------------------------- money the gate relies on
CREATE OR REPLACE FUNCTION naro_r3_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."rentalOrderId" IS NOT NULL THEN
      SELECT "tenantId" INTO t FROM "RentalOrder" WHERE id = NEW."rentalOrderId";
      IF NEW."tenantId" IS DISTINCT FROM t THEN
        RAISE EXCEPTION 'R3_LEDGER_GUARD: a rental payment must belong to the booking''s shop' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."rentalOrderId" IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- orders / POS sales: unchanged rules
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('COMPLETED', 'REFUNDED', 'REVERSED') THEN
      RAISE EXCEPTION 'R3_LEDGER_GUARD: settled rental payment % can''t be removed', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR (NEW."rentalOrderId" IS DISTINCT FROM OLD."rentalOrderId"
         AND NOT (NEW."rentalOrderId" IS NULL AND OLD.status NOT IN ('COMPLETED', 'REFUNDED', 'REVERSED'))) THEN
    RAISE EXCEPTION 'R3_LEDGER_GUARD: rental payment % can''t be moved to another booking or shop', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('COMPLETED', 'REFUNDED', 'REVERSED') THEN
    IF (NEW.amount, NEW.component, NEW.method, NEW."orderId", NEW."layawayId", NEW."refundOfPaymentId", NEW."refundRequestId", NEW."transactionRef", NEW."createdAt")
       IS DISTINCT FROM (OLD.amount, OLD.component, OLD.method, OLD."orderId", OLD."layawayId", OLD."refundOfPaymentId", OLD."refundRequestId", OLD."transactionRef", OLD."createdAt") THEN
      RAISE EXCEPTION 'R3_LEDGER_GUARD: settled rental payment % can''t be rewritten', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status IN ('COMPLETED', 'REFUNDED') AND NEW.status = 'REVERSED') THEN
      RAISE EXCEPTION 'R3_LEDGER_GUARD: settled rental payment % may only be reversed (% -> %)', OLD.id, OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION naro_r3_payment_guard();
CREATE TRIGGER naro_r3_payment_no_truncate BEFORE TRUNCATE ON "Payment" FOR EACH STATEMENT EXECUTE FUNCTION naro_r3_immutable();

CREATE OR REPLACE FUNCTION naro_r3_rental_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."tenantId", NEW."userId", NEW."productId", NEW."totalRentalPrice", NEW."damageDeposit")
     IS DISTINCT FROM (OLD."tenantId", OLD."userId", OLD."productId", OLD."totalRentalPrice", OLD."damageDeposit") THEN
    RAISE EXCEPTION 'R3_LEDGER_GUARD: a booking''s shop, customer, product, fee and deposit are fixed at booking (rental %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_rental_terms_guard BEFORE UPDATE ON "RentalOrder" FOR EACH ROW EXECUTE FUNCTION naro_r3_rental_terms_guard();

-- ---------------------------------------------------------------- lock the functions down
-- SECURITY DEFINER (they run as the owner, so the runtime role needs no
-- EXECUTE and gets none), a fixed search_path naming THIS schema then pg_temp
-- last (no shadowing by temporary tables), EXECUTE revoked from PUBLIC.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = current_schema() AND p.proname LIKE 'naro\_r3\_%' LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = %I, pg_temp', f.sig, current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
