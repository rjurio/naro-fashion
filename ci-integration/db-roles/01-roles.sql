-- NARO database role separation, step 1 of 3: the runtime role.
-- Run ONCE per database, as a SUPERUSER (on the VPS: sudo -u postgres psql),
-- in an owner-authorised window, after a rehearsal on a copy. Idempotent.
--
--   NARO_APP_DB_PASSWORD='<new random value>' \
--   psql -X -v ON_ERROR_STOP=1 -v db=naro_fashion -v owner=naro_admin -v app=naro_app \
--        -v schema=public -d naro_fashion -f scripts/ops/db-roles/01-roles.sql
--
-- Roles after this script:
--   owner (naro_admin, unchanged): owns the database, the schema's tables and
--         the R3 functions; runs migrations (deploy.sh) and recovery
--         overrides. Its password must then live ONLY in root-only files
--         (/etc/naro-db-owner.env, /root/.pgpass), never in the app .env files.
--   app   (naro_app, new): what the API connects as. LOGIN only: not a
--         superuser, can't create databases or roles, no replication, no RLS
--         bypass, member of no role (so it can't SET ROLE to the owner), no
--         CREATE / TEMP on the database, no CREATE on the schema.
-- The password is read from the environment (never written in this file or
-- on a command line). log_statement is 'none' in production (checked
-- 2026-11-13), so the CREATE/ALTER ROLE statement isn't logged.

\getenv app_password NARO_APP_DB_PASSWORD
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'NARO_APP_DB_PASSWORD is not set'; END $$;
\endif
SELECT length(:'app_password') >= 24 AS pw_ok \gset
\if :pw_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'NARO_APP_DB_PASSWORD must be at least 24 characters (openssl rand -hex 24)'; END $$;
\endif

SELECT rolsuper AS i_am_super FROM pg_roles WHERE rolname = current_user \gset
\if :i_am_super
\else
  DO $$ BEGIN RAISE EXCEPTION 'run 01-roles.sql as a superuser'; END $$;
\endif
SELECT :'owner' <> :'app' AS distinct_roles \gset
\if :distinct_roles
\else
  DO $$ BEGIN RAISE EXCEPTION 'owner and app roles must differ'; END $$;
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') AS create_app \gset
\if :create_app
  CREATE ROLE :"app" LOGIN PASSWORD :'app_password';
\else
  ALTER ROLE :"app" LOGIN PASSWORD :'app_password';
\endif
ALTER ROLE :"app" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 40;
-- Bound a stuck transaction (it would hold advisory locks and row locks).
ALTER ROLE :"app" SET idle_in_transaction_session_timeout = '60s';

-- The app must be a member of NO role (no SET ROLE to the owner).
SELECT count(*) = 0 AS no_memberships FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = :'app' \gset
\if :no_memberships
\else
  DO $$ BEGIN RAISE EXCEPTION 'the app role is a member of another role: revoke that membership first'; END $$;
\endif

-- Database: only the owner and the app may connect; no temporary objects
-- for anyone but the owner (a temp table can't then shadow a real one).
REVOKE CONNECT, TEMPORARY ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app";
REVOKE TEMPORARY, CREATE ON DATABASE :"db" FROM :"app";

\connect :db
-- Schema: nobody but the owner may create objects in it.
REVOKE CREATE ON SCHEMA :"schema" FROM PUBLIC;
GRANT USAGE ON SCHEMA :"schema" TO :"app";

-- Tables/sequences the owner creates later (migrations) are usable by the
-- app at once; 02-grants.sql then removes what the app must not do.
-- Functions the owner creates are NOT executable by PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA :"schema" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA :"schema" GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

\echo 'step 1 done: now run 02-grants.sql as the owner, then 03-verify.sql'
