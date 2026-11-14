#!/usr/bin/env bash
# Rebuild the isolated schema it_r4 (local dev Postgres only). API must be stopped.
set -euo pipefail
S="$1"; export PGPASSWORD=Admin123
"/c/Program Files/PostgreSQL/17/bin/psql" -U naro_admin -h localhost -d naro_fashion -w -qAt -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS it_r4 CASCADE;"
cd "$S/naro-r4-wt/packages/database" && DATABASE_URL='postgresql://naro_admin:Admin123@localhost:5432/naro_fashion?schema=it_r4' NODE_OPTIONS=--use-system-ca pnpm prisma migrate deploy 2>&1 | tail -1
