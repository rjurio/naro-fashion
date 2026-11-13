-- Round 25E D: separation of duties for refunds, enforced by the database too
-- (defence in depth behind the API checks in refunds/separation.ts).
-- Expand-only: one function + one trigger, no table or data change.
--   * -> APPROVED: the approver is not the requester;
--   * -> PAID: the payer is neither the requester nor the approver;
--   * a DEPOSIT_RETURN that keeps money (retainedAmount > 0): neither the
--     approver nor the payer decided the RESOLVED_DEDUCTED discrepancy.
CREATE OR REPLACE FUNCTION naro_r3_refund_separation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW."approvedById" IS NULL OR NEW."approvedById" = NEW."requestedById" THEN
      RAISE EXCEPTION 'R3_REFUND_SEPARATION: refund % must be approved by someone other than the requester', NEW.id USING ERRCODE = 'P0001';
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
CREATE TRIGGER naro_r3_refund_separation BEFORE UPDATE ON "RentalRefundRequest" FOR EACH ROW EXECUTE FUNCTION naro_r3_refund_separation();

DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION naro_r3_refund_separation() SECURITY DEFINER SET search_path = %I, pg_temp', current_schema());
  EXECUTE 'REVOKE ALL ON FUNCTION naro_r3_refund_separation() FROM PUBLIC';
END $$;
