-- NARO database role separation, step 2 of 3: the runtime role's privileges.
-- Run as the OWNER role (naro_admin) after 01-roles.sql AND after EVERY
-- `prisma migrate deploy` (deploy.sh does this when /etc/naro-db-owner.env
-- exists). Idempotent; only GRANT/REVOKE, no data changes.
--
--   psql -X -v ON_ERROR_STOP=1 -v app=naro_app -v schema=public "$OWNER_URL" -f scripts/ops/db-roles/02-grants.sql
--
-- What the app may do:
--   * read and write ordinary application tables (SELECT/INSERT/UPDATE/DELETE);
--   * NEVER: TRUNCATE, TRIGGER, REFERENCES, ownership, DDL (it owns nothing);
--   * append-only history (insert + read, never update or delete): admin
--     activity log, AI agent audit log, inventory ledger, R3 checklist
--     records / snapshots / snapshot items;
--   * forward-only records (no delete): payments, refund requests, late-fee
--     waivers, gown-tracking changes, checklist exceptions, discrepancies, the
--     hand-over safety switch;
--   * R3 recovery overrides: read only (the owner creates them; the gate
--     consumes them through a SECURITY DEFINER function);
--   * migration history: nothing;
--   * naro_* database functions: no EXECUTE (the triggers run them as the owner).
-- Tables that don't exist yet (older releases) are skipped; re-running after
-- the migration that adds them applies the rule.

SELECT set_config('naro.grant_app', :'app', false) AS g_app, set_config('naro.grant_schema', :'schema', false) AS g_schema \gset

DO $$
DECLARE
  app text := current_setting('naro.grant_app');
  sch text := current_setting('naro.grant_schema');
  t text; f regprocedure;
  append_only text[] := ARRAY['AdminActivityLog', 'AgentAuditLog', 'InventoryTransaction',
                              'RentalChecklistRecord', 'RentalChecklistSnapshot', 'RentalChecklistSnapshotItem'];
  no_delete text[] := ARRAY['Payment', 'RentalRefundRequest', 'RentalLateFeeWaiver', 'RentalUnitTrackingChange',
                            'RentalChecklistException', 'RentalDiscrepancy', 'RentalHandoverSafeguard'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app) THEN RAISE EXCEPTION 'role % does not exist (run 01-roles.sql)', app; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN RAISE EXCEPTION 'schema % does not exist', sch; END IF;
  IF pg_has_role(app, current_user, 'MEMBER') OR app = current_user THEN
    RAISE EXCEPTION 'run 02-grants.sql as the owner role, not as %', current_user;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', sch, app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', sch, app);
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I', sch, app);
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA %I FROM %I', sch, app);

  IF to_regclass(format('%I.%I', sch, '_prisma_migrations')) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON %I.%I FROM %I', sch, '_prisma_migrations', app);
  END IF;
  FOREACH t IN ARRAY append_only LOOP
    IF to_regclass(format('%I.%I', sch, t)) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', sch, t, app);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY no_delete LOOP
    IF to_regclass(format('%I.%I', sch, t)) IS NOT NULL THEN
      EXECUTE format('REVOKE DELETE ON %I.%I FROM %I', sch, t, app);
    END IF;
  END LOOP;
  IF to_regclass(format('%I.%I', sch, 'RentalGateOverride')) IS NOT NULL THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I.%I FROM %I', sch, 'RentalGateOverride', app);
  END IF;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = sch AND p.proname LIKE 'naro\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, %I', f, app);
  END LOOP;
END $$;

\echo 'step 2 done: run 03-verify.sql'
