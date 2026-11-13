-- refunds:payout hardening: the payout rules enforced by the database too
-- (defence in depth behind refunds/separation.ts + refunds/payout-controls.ts).
-- Expand-only: two trigger functions (one replaced, one new) and one trigger.
-- No table, column, index or data change; nothing to undo for an app rollback
-- (the previous code already pays only APPROVED, independently approved
-- requests, so it satisfies every rule below).
--
-- RentalRefundRequest (naro_r3_refund_separation, replaced):
--   * as before: -> APPROVED by someone other than the requester; -> PAID by
--     someone who neither requested nor approved it; the decider of a
--     deposit deduction neither approves nor pays the refund that keeps money;
--   * NEW: -> PAYING only from APPROVED, -> PAID only from APPROVED / PAYING,
--     and both only with an approver on record who is not the requester;
--   * NEW: once a request has left REQUESTED, who asked, who approved, the shop,
--     subject, kind, component, target (rental / order / layaway) and the
--     amount kept are fixed, and the amount can only go DOWN (a sale return
--     re-valued at payout) — an approval can't be re-pointed or inflated.
-- Payment (naro_r3_refund_payout_guard, new): a row linked to a refund request
--   (refundRequestId) is a REFUNDED payout of that request: same shop, same
--   target, the request APPROVED / PAYING and independently approved, and the
--   amount no more than the approved amount; a payment can't be linked to a
--   request afterwards.
CREATE OR REPLACE FUNCTION naro_r3_refund_separation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'REQUESTED' THEN
    IF (NEW."tenantId", NEW.subject, NEW.kind, NEW.component, NEW."rentalOrderId", NEW."orderId", NEW."layawayId",
        NEW."requestedById", NEW."approvedById", NEW."retainedAmount")
       IS DISTINCT FROM (OLD."tenantId", OLD.subject, OLD.kind, OLD.component, OLD."rentalOrderId", OLD."orderId", OLD."layawayId",
        OLD."requestedById", OLD."approvedById", OLD."retainedAmount") THEN
      RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % is decided; its requester, approver, shop, target and amount kept are fixed', OLD.id USING ERRCODE = 'P0001';
    END IF;
    IF NEW.amount > OLD.amount THEN
      RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % can''t be raised above the amount approved (% -> %)', OLD.id, OLD.amount, NEW.amount USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW."approvedById" IS NULL OR NEW."approvedById" = NEW."requestedById" THEN
      RAISE EXCEPTION 'R3_REFUND_SEPARATION: refund % must be approved by someone other than the requester', NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status NOT IN ('REQUESTED', 'PAYING') THEN
      RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % can''t return to APPROVED from %', NEW.id, OLD.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF (NEW.status = 'PAYING' AND OLD.status IS DISTINCT FROM 'PAYING') OR (NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID') THEN
    IF NOT ((NEW.status = 'PAYING' AND OLD.status = 'APPROVED') OR (NEW.status = 'PAID' AND OLD.status IN ('APPROVED', 'PAYING'))) THEN
      RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % can''t be paid from %; only an APPROVED refund is paid', NEW.id, OLD.status USING ERRCODE = 'P0001';
    END IF;
    IF NEW."approvedById" IS NULL OR NEW."approvedById" = NEW."requestedById" THEN
      RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % has no independent approval on record', NEW.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    IF NEW."paidById" IS NULL OR NEW."paidById" = NEW."requestedById" OR NEW."paidById" = NEW."approvedById" THEN
      RAISE EXCEPTION 'R3_REFUND_SEPARATION: refund % must be paid by someone who neither requested nor approved it', NEW.id USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.kind = 'DEPOSIT_RETURN' AND COALESCE(NEW."retainedAmount", 0) > 0 AND NEW."rentalOrderId" IS NOT NULL
     AND ((NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED') OR (NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID'))
     AND EXISTS (SELECT 1 FROM "RentalDiscrepancy" d
                  WHERE d."rentalOrderId" = NEW."rentalOrderId" AND d.status = 'RESOLVED_DEDUCTED'
                    AND d."resolvedById" IN (NEW."approvedById", CASE WHEN NEW.status = 'PAID' THEN NEW."paidById" END)) THEN
    RAISE EXCEPTION 'R3_REFUND_SEPARATION: the person who decided the deduction cannot approve or pay the deposit refund % that keeps the money', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION naro_r3_refund_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
  IF NEW."refundRequestId" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."refundRequestId" IS NOT DISTINCT FROM OLD."refundRequestId" THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: payment % can''t be linked to a refund request afterwards', OLD.id USING ERRCODE = 'P0001';
  END IF;
  SELECT r."tenantId", r.status, r."requestedById", r."approvedById", r.amount, r."rentalOrderId", r."orderId", r."layawayId"
    INTO q FROM "RentalRefundRequest" r WHERE r.id = NEW."refundRequestId";
  IF NOT FOUND OR q."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: a refund payout must belong to its request''s shop' USING ERRCODE = 'P0001';
  END IF;
  IF q.status NOT IN ('APPROVED', 'PAYING') OR q."approvedById" IS NULL OR q."approvedById" = q."requestedById" THEN
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: refund % is not independently approved (status %); no payout row', NEW."refundRequestId", q.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM 'REFUNDED' THEN
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: a refund payout row is REFUNDED (got %)', NEW.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount > q.amount THEN
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: payout % is more than the % approved for refund %', NEW.amount, q.amount, NEW."refundRequestId" USING ERRCODE = 'P0001';
  END IF;
  IF (q."rentalOrderId" IS NOT NULL AND NEW."rentalOrderId" IS DISTINCT FROM q."rentalOrderId")
     OR (q."orderId" IS NOT NULL AND NEW."orderId" IS DISTINCT FROM q."orderId")
     OR (q."layawayId" IS NOT NULL AND NEW."layawayId" IS DISTINCT FROM q."layawayId") THEN
    RAISE EXCEPTION 'R3_REFUND_PAYOUT_GUARD: payout for refund % must go to the request''s own booking / sale / layaway', NEW."refundRequestId" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_refund_payout_guard BEFORE INSERT OR UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION naro_r3_refund_payout_guard();

-- SECURITY DEFINER, fixed search_path (this schema, then pg_temp), no PUBLIC
-- EXECUTE — as every naro_r3_* function (CREATE OR REPLACE resets these).
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = current_schema() AND p.proname IN ('naro_r3_refund_separation', 'naro_r3_refund_payout_guard') LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = %I, pg_temp', f.sig, current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
