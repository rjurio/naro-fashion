#!/usr/bin/env bash
# Recreate the ISOLATED schema it_id from the worktree's committed migrations
# (local dev Postgres only). Then: boot the local API once on it_id
# (permissions + system roles), run id-seed.js, run id-enforcement.it.mjs.
# Drop it afterwards:  psql ... -c "DROP SCHEMA it_id CASCADE"
#   bash id-reset.sh <worktree>
set -euo pipefail
WT="$1"; PGB="/c/Program Files/PostgreSQL/17/bin"; export PGPASSWORD=Admin123
"$PGB/psql" -U naro_admin -h localhost -d naro_fashion -qAt -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS it_id CASCADE"
cd "$WT/packages/database"
DATABASE_URL='postgresql://naro_admin:Admin123@localhost:5432/naro_fashion?schema=it_id' pnpm prisma migrate deploy | tail -1
