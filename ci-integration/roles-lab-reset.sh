#!/usr/bin/env bash
# Rebuild an ISOLATED schema for the least-privilege tests (round 25D B):
# owner (naro_admin) creates the schema and runs every migration, then
# 02-grants.sql gives the runtime role (naro_app) its privileges and
# 03-verify.sql must pass. Local lab cluster or CI service only.
#   PGPORT=55433 PSQL=<psql> roles-lab-reset.sh <worktree> <schema> <db-roles-dir>
set -euo pipefail
WT="$1"; SCHEMA="$2"; ROLES="$3"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PSQL:=psql}"
case "$PGHOST" in localhost|127.0.0.1) ;; *) echo "refusing: local/CI database only" >&2; exit 2 ;; esac
case "$SCHEMA" in it_*) ;; *) echo "refusing: schema must start with it_" >&2; exit 2 ;; esac
export PGHOST PGPORT
OWN() { PGPASSWORD=Admin123 "$PSQL" -U naro_admin -d naro_fashion -w -X -q -v ON_ERROR_STOP=1 "$@"; }
OWN -c "SET client_min_messages = warning" -c "DROP SCHEMA IF EXISTS $SCHEMA CASCADE" -c "CREATE SCHEMA $SCHEMA"
(cd "$WT/packages/database" && DATABASE_URL="postgresql://naro_admin:Admin123@${PGHOST}:${PGPORT}/naro_fashion?schema=${SCHEMA}" pnpm exec prisma migrate deploy >/dev/null)
echo "migrations applied to $SCHEMA: $(OWN -qAt -c "SELECT count(*) FROM $SCHEMA._prisma_migrations WHERE finished_at IS NOT NULL")"
OWN -v app=naro_app -v schema="$SCHEMA" -f "$ROLES/02-grants.sql" >/dev/null
OWN -v app=naro_app -v owner=naro_admin -v schema="$SCHEMA" -f "$ROLES/03-verify.sql" | tail -1
