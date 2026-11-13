-- Round 25F D: two-person activation of checklist templates. Expand-only:
-- new nullable / defaulted columns, functions and triggers; no data change
-- except that every existing template starts as DRAFT (production has 0).
--
--  * A template is used for a booking's snapshot only when it is APPROVED for
--    its CURRENT version, and its current content still hashes to the
--    approved hash (scope + every item's label, quantity, stage, mandatory,
--    condition, order).
--  * The approver is an active staff member of the shop holding
--    rentals:checklist-approve (SUPER_ADMIN holds every permission) who did
--    NOT prepare this version (draftAuthorIds). No role bypasses that rule.
--  * An edit or a scope change can't keep APPROVED: it returns to DRAFT.
--  * A snapshot insert naming a template is refused unless all of the above
--    hold — even for a direct SQL caller. Existing snapshots never change
--    (they are immutable since 20261116090000).

-- AlterTable
ALTER TABLE "RentalChecklistTemplate" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedHash" TEXT,
ADD COLUMN     "approvedVersion" INTEGER,
ADD COLUMN     "draftAuthorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "withdrawalReason" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnById" TEXT;

-- AlterTable
ALTER TABLE "RentalChecklistSnapshot" ADD COLUMN     "templateHash" TEXT;

-- The content hash (must match checklist-core.ts templateContentHash).
CREATE OR REPLACE FUNCTION naro_r3_template_hash(p_template text, p_product text, p_category text, p_default boolean) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(
    'scope:' || coalesce(p_product, '') || '|' || coalesce(p_category, '') || '|' || coalesce(p_default, false)::text || E'\n' ||
    coalesce((SELECT string_agg(i.label || '|' || i.quantity::text || '|' || i."itemType" || '|' || i."isMandatory"::text || '|' || i."requiresCondition"::text || '|' || i."sortOrder"::text,
                                E'\n' ORDER BY i."sortOrder", i.id COLLATE "C")
                FROM "RentalChecklistTemplateItem" i WHERE i."templateId" = p_template), ''),
    'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION naro_r3_template_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE problem text;
BEGIN
  IF NEW."approvalStatus" = 'APPROVED' AND (OLD."approvalStatus" IS DISTINCT FROM 'APPROVED'
       OR NEW."approvedVersion" IS DISTINCT FROM OLD."approvedVersion" OR NEW."approvedHash" IS DISTINCT FROM OLD."approvedHash"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById") THEN
    IF NEW."approvedById" IS NULL OR NEW."approvedById" = ANY (COALESCE(NEW."draftAuthorIds", '{}')) THEN
      RAISE EXCEPTION 'R3_TEMPLATE_APPROVAL: template % must be approved by someone who did not prepare this version', NEW.id USING ERRCODE = 'P0001';
    END IF;
    IF NEW."approvedVersion" IS DISTINCT FROM NEW.version
       OR NEW."approvedHash" IS DISTINCT FROM naro_r3_template_hash(NEW.id, NEW."productId", NEW."categoryId", NEW."isDefault") THEN
      RAISE EXCEPTION 'R3_TEMPLATE_APPROVAL: the approval of template % does not match its current version and content', NEW.id USING ERRCODE = 'P0001';
    END IF;
    problem := naro_r3_staff_problem(NEW."tenantId", NEW."approvedById", 'rentals:checklist-approve');
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION 'R3_TEMPLATE_APPROVAL: approval of template % refused (%)', NEW.id, problem USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW."approvalStatus" = 'APPROVED' AND (NEW.version IS DISTINCT FROM OLD.version
       OR (NEW."productId", NEW."categoryId", NEW."isDefault") IS DISTINCT FROM (OLD."productId", OLD."categoryId", OLD."isDefault")) THEN
    RAISE EXCEPTION 'R3_TEMPLATE_APPROVAL: an edited template % must return to DRAFT and be approved again', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_template_approval_guard BEFORE UPDATE ON "RentalChecklistTemplate" FOR EACH ROW EXECUTE FUNCTION naro_r3_template_approval_guard();

CREATE OR REPLACE FUNCTION naro_r3_snapshot_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record;
BEGIN
  IF NEW."templateId" IS NULL THEN RETURN NEW; END IF;
  SELECT id, "tenantId", version, "approvalStatus", "approvedVersion", "approvedHash", "productId", "categoryId", "isDefault", "isActive", "deletedAt"
    INTO t FROM "RentalChecklistTemplate" WHERE id = NEW."templateId";
  IF t.id IS NULL OR t."tenantId" IS DISTINCT FROM NEW."tenantId" OR t."approvalStatus" IS DISTINCT FROM 'APPROVED'
     OR t."deletedAt" IS NOT NULL OR NOT t."isActive"
     OR t."approvedVersion" IS DISTINCT FROM t.version OR NEW."templateVersion" IS DISTINCT FROM t.version
     OR NEW."templateHash" IS DISTINCT FROM t."approvedHash"
     OR t."approvedHash" IS DISTINCT FROM naro_r3_template_hash(t.id, t."productId", t."categoryId", t."isDefault") THEN
    RAISE EXCEPTION 'R3_TEMPLATE_NOT_APPROVED: rental % can''t take a checklist from template % (not approved for its current version and content)', NEW."rentalOrderId", NEW."templateId" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER naro_r3_snapshot_template_guard BEFORE INSERT ON "RentalChecklistSnapshot" FOR EACH ROW EXECUTE FUNCTION naro_r3_snapshot_template_guard();

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = current_schema() AND p.proname IN ('naro_r3_template_hash', 'naro_r3_template_approval_guard', 'naro_r3_snapshot_template_guard') LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = %I, pg_temp', f.sig, current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
