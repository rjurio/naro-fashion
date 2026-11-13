-- NARO database role separation, step 3 of 3: verify (read-only).
-- Run as the owner or a superuser, after 02-grants.sql, after every deploy,
-- and in release checks. Prints every check; FAILS (exit 3 with
-- ON_ERROR_STOP) if any check fails. Writes nothing (one read-only query).
--
--   psql -X -v ON_ERROR_STOP=1 -v app=naro_app -v owner=naro_admin -v schema=public -d naro_fashion -f scripts/ops/db-roles/03-verify.sql
--
-- R3 checks (triggers, function hardening) apply only once the R3 tables
-- exist; before that they report "n/a".

BEGIN READ ONLY;
SELECT set_config('naro.v_app', :'app', true) AS v_app, set_config('naro.v_owner', :'owner', true) AS v_owner,
       set_config('naro.v_schema', :'schema', true) AS v_schema \gset

WITH p AS (SELECT current_setting('naro.v_app') AS app, current_setting('naro.v_owner') AS owner, current_setting('naro.v_schema') AS sch),
r3 AS (SELECT to_regclass(format('%I.%I', (SELECT sch FROM p), 'RentalChecklistSnapshot')) IS NOT NULL AS present),
hard AS (SELECT to_regclass(format('%I.%I', (SELECT sch FROM p), 'RentalGateOverride')) IS NOT NULL
               AND EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
                            WHERE n.nspname = (SELECT sch FROM p) AND pr.proname = 'naro_r3_release_problem') AS present),
tabs AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = (SELECT sch FROM p) AND c.relkind IN ('r', 'p')),
checks(name, ok, detail) AS (
  SELECT 'app role exists and can log in',
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = (SELECT app FROM p) AND rolcanlogin), (SELECT app FROM p)
  UNION ALL SELECT 'app is not superuser / createrole / createdb / replication / bypassrls',
         NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = (SELECT app FROM p)
                      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)), ''
  UNION ALL SELECT 'app is a member of no role (no SET ROLE to the owner)',
         NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = (SELECT app FROM p)), ''
  UNION ALL SELECT 'owner and app are different roles', (SELECT app <> owner FROM p), ''
  UNION ALL SELECT 'app owns no table, sequence, view, function, type or schema',
         NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = (SELECT app FROM p)))
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = (SELECT app FROM p)))
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typowner = (SELECT oid FROM pg_roles WHERE rolname = (SELECT app FROM p)))
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = (SELECT app FROM p))), ''
  UNION ALL SELECT 'the owner owns every table in the schema',
         NOT EXISTS (SELECT 1 FROM pg_class c JOIN tabs t ON t.oid = c.oid WHERE pg_get_userbyid(c.relowner) <> (SELECT owner FROM p)),
         (SELECT string_agg(t.relname, ', ') FROM tabs t JOIN pg_class c ON c.oid = t.oid WHERE pg_get_userbyid(c.relowner) <> (SELECT owner FROM p))
  UNION ALL SELECT 'app may not CREATE or use TEMP in the database',
         NOT has_database_privilege((SELECT app FROM p), current_database(), 'CREATE')
     AND NOT has_database_privilege((SELECT app FROM p), current_database(), 'TEMP'), ''
  UNION ALL SELECT 'PUBLIC may not connect to the database',
         NOT EXISTS (SELECT 1 FROM pg_database d, aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
                      WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type IN ('CONNECT', 'TEMPORARY')), ''
  UNION ALL SELECT 'app may not CREATE in the schema', NOT has_schema_privilege((SELECT app FROM p), (SELECT sch FROM p), 'CREATE'), ''
  UNION ALL SELECT 'app holds no TRUNCATE / TRIGGER / REFERENCES on any table',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE has_table_privilege((SELECT app FROM p), t.oid, 'TRUNCATE')
                      OR has_table_privilege((SELECT app FROM p), t.oid, 'TRIGGER') OR has_table_privilege((SELECT app FROM p), t.oid, 'REFERENCES')),
         (SELECT string_agg(t.relname, ', ') FROM tabs t WHERE has_table_privilege((SELECT app FROM p), t.oid, 'TRUNCATE')
                      OR has_table_privilege((SELECT app FROM p), t.oid, 'TRIGGER') OR has_table_privilege((SELECT app FROM p), t.oid, 'REFERENCES'))
  UNION ALL SELECT 'app can read and write the ordinary tables (e.g. RentalOrder, Product)',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE t.relname IN ('RentalOrder', 'Product')
                      AND NOT (has_table_privilege((SELECT app FROM p), t.oid, 'SELECT') AND has_table_privilege((SELECT app FROM p), t.oid, 'INSERT')
                               AND has_table_privilege((SELECT app FROM p), t.oid, 'UPDATE'))), ''
  UNION ALL SELECT 'append-only history: no UPDATE / DELETE for the app',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE t.relname IN ('AdminActivityLog', 'AgentAuditLog', 'InventoryTransaction',
                       'RentalChecklistRecord', 'RentalChecklistSnapshot', 'RentalChecklistSnapshotItem')
                      AND (has_table_privilege((SELECT app FROM p), t.oid, 'UPDATE') OR has_table_privilege((SELECT app FROM p), t.oid, 'DELETE'))),
         (SELECT string_agg(t.relname, ', ') FROM tabs t WHERE t.relname IN ('AdminActivityLog', 'AgentAuditLog', 'InventoryTransaction',
                       'RentalChecklistRecord', 'RentalChecklistSnapshot', 'RentalChecklistSnapshotItem')
                      AND (has_table_privilege((SELECT app FROM p), t.oid, 'UPDATE') OR has_table_privilege((SELECT app FROM p), t.oid, 'DELETE')))
  UNION ALL SELECT 'forward-only records: no DELETE for the app',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE t.relname IN ('Payment', 'RentalRefundRequest', 'RentalLateFeeWaiver', 'RentalUnitTrackingChange',
                       'RentalChecklistException', 'RentalDiscrepancy', 'RentalHandoverSafeguard')
                      AND has_table_privilege((SELECT app FROM p), t.oid, 'DELETE')),
         (SELECT string_agg(t.relname, ', ') FROM tabs t WHERE t.relname IN ('Payment', 'RentalRefundRequest', 'RentalLateFeeWaiver', 'RentalUnitTrackingChange',
                       'RentalChecklistException', 'RentalDiscrepancy', 'RentalHandoverSafeguard') AND has_table_privilege((SELECT app FROM p), t.oid, 'DELETE'))
  UNION ALL SELECT 'recovery overrides: read only for the app',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE t.relname = 'RentalGateOverride'
                      AND (has_table_privilege((SELECT app FROM p), t.oid, 'INSERT') OR has_table_privilege((SELECT app FROM p), t.oid, 'UPDATE')
                           OR has_table_privilege((SELECT app FROM p), t.oid, 'DELETE'))), ''
  UNION ALL SELECT 'app has no access to the migration history',
         NOT EXISTS (SELECT 1 FROM tabs t WHERE t.relname = '_prisma_migrations' AND has_table_privilege((SELECT app FROM p), t.oid, 'SELECT')), ''
  UNION ALL SELECT 'app and PUBLIC may not EXECUTE any naro_* function',
         NOT EXISTS (SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
                      WHERE n.nspname = (SELECT sch FROM p) AND pr.proname LIKE 'naro\_%'
                        AND (has_function_privilege((SELECT app FROM p), pr.oid, 'EXECUTE')
                             OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(pr.proacl, acldefault('f', pr.proowner))) a WHERE a.grantee = 0))),
         (SELECT string_agg(pr.proname, ', ') FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
                      WHERE n.nspname = (SELECT sch FROM p) AND pr.proname LIKE 'naro\_%' AND has_function_privilege((SELECT app FROM p), pr.oid, 'EXECUTE'))
  UNION ALL SELECT 'R3 functions: owned by the owner, SECURITY DEFINER, search_path = schema, pg_temp',
         CASE WHEN NOT (SELECT present FROM hard) THEN NULL ELSE NOT EXISTS (
           SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
            WHERE n.nspname = (SELECT sch FROM p) AND pr.proname LIKE 'naro\_r3\_%'
              AND (NOT pr.prosecdef OR pg_get_userbyid(pr.proowner) <> (SELECT owner FROM p)
                   OR NOT (COALESCE(pr.proconfig, '{}') @> ARRAY[format('search_path=%s, pg_temp', quote_ident((SELECT sch FROM p)))]))) END,
         (SELECT string_agg(pr.proname, ', ') FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
            WHERE n.nspname = (SELECT sch FROM p) AND pr.proname LIKE 'naro\_r3\_%'
              AND (NOT pr.prosecdef OR NOT (COALESCE(pr.proconfig, '{}') @> ARRAY[format('search_path=%s, pg_temp', quote_ident((SELECT sch FROM p)))])))
  UNION ALL SELECT 'R3 gate triggers present and ENABLED',
         CASE WHEN NOT (SELECT present FROM r3) THEN NULL ELSE (
           SELECT count(*) = 2 FROM pg_trigger tg JOIN tabs t ON t.oid = tg.tgrelid
            WHERE tg.tgname IN ('naro_r3_rental_gate', 'naro_r3_deposit_gate') AND tg.tgenabled = 'O') END, ''
  UNION ALL SELECT 'R3 evidence immutability triggers present and ENABLED',
         CASE WHEN NOT (SELECT present FROM hard) THEN NULL ELSE (
           SELECT count(*) = 9 FROM pg_trigger tg JOIN tabs t ON t.oid = tg.tgrelid
            WHERE tg.tgname IN ('naro_r3_record_immutable', 'naro_r3_record_no_truncate', 'naro_r3_snapshot_immutable', 'naro_r3_snapshot_no_truncate',
                                'naro_r3_snapshot_item_immutable', 'naro_r3_snapshot_item_no_truncate', 'naro_r3_exception_guard',
                                'naro_r3_discrepancy_guard', 'naro_r3_override_guard') AND tg.tgenabled = 'O') END, ''
  UNION ALL SELECT 'R3 trusted-control triggers present and ENABLED (evidence insert, payments, booking terms)',
         CASE WHEN NOT (SELECT present FROM hard) THEN NULL ELSE (
           SELECT count(*) = 4 FROM pg_trigger tg JOIN tabs t ON t.oid = tg.tgrelid
            WHERE tg.tgname IN ('naro_r3_record_insert_guard', 'naro_r3_payment_guard', 'naro_r3_payment_no_truncate', 'naro_r3_rental_terms_guard')
              AND tg.tgenabled = 'O') END, ''
  UNION ALL SELECT 'no user trigger anywhere in the schema is disabled',
         NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN tabs t ON t.oid = tg.tgrelid WHERE NOT tg.tgisinternal AND tg.tgenabled <> 'O'),
         (SELECT string_agg(tg.tgname, ', ') FROM pg_trigger tg JOIN tabs t ON t.oid = tg.tgrelid WHERE NOT tg.tgisinternal AND tg.tgenabled <> 'O')
)
SELECT string_agg(format('%-4s  %s%s', CASE WHEN ok IS NULL THEN 'n/a' WHEN ok THEN 'OK' ELSE 'FAIL' END, name,
                          CASE WHEN NULLIF(detail, '') IS NULL THEN '' ELSE ' -- ' || detail END), E'\n') AS report,
       count(*) FILTER (WHERE ok IS FALSE) > 0 AS any_fail,
       count(*) FILTER (WHERE ok IS FALSE) AS failures
FROM checks \gset
ROLLBACK;
\echo :report
\if :any_fail
  \echo 'ROLE SEPARATION CHECK FAILED:' :failures 'failing check(s)'
  DO $$ BEGIN RAISE EXCEPTION 'role separation check failed'; END $$;
\else
  \echo 'role separation check: all OK'
\endif
