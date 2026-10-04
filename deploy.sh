#!/usr/bin/env bash
# Naro Fashion production deploy.
#
# Invoked by .github/workflows/deploy-prod.yml (after the `verify` job is
# green) as:   EXPECTED_SHA=<github.sha> bash deploy.sh
# Can also be run by hand on the VPS:   bash deploy.sh
# Manual rollback to the previous build: bash scripts/ops/rollback.sh
#
# Stages (each one aborts the deploy on failure — `set -euo pipefail`):
#   1. git fetch + hard reset to origin/prod, assert HEAD == $EXPECTED_SHA
#   2. pnpm install --frozen-lockfile
#   3. prisma generate
#   4. PRE-DEPLOY DATABASE BACKUP (abort if the dump fails / is empty)
#   5. migrations: one-time baseline of 0_init (only if the DB is verified
#      drift-free), then `prisma migrate deploy` (committed migrations only;
#      `db push --accept-data-loss` is gone), then a drift check
#   6. sequential SIDE builds (api -> storefront -> admin) to dodge the 2GB
#      OOM. Next apps build into apps/<app>/.next-build (NEXT_DIST_DIR) and
#      are verified; the live .next is untouched until ALL builds succeed
#   7. swap: .next -> .next-prev, .next-build -> .next (per app), API
#      dist-prev promoted, then IMMEDIATELY pm2 reload with GIT_SHA
#   8. post-deploy health checks. On failure -> AUTOMATIC ROLLBACK of the
#      app builds + source tree (NOT the database) and exit non-zero.
#
# Zero downtime is NOT achievable here: every PM2 app is fork mode with a
# single instance on a 2GB box, so `pm2 reload` is a restart (a few seconds
# of 502s per app). What this script guarantees instead: the live process is
# never pointed at a half-written build, and a bad release is reverted
# automatically. See docs/OPS/DEPLOY.md.

set -euo pipefail

APP_DIR="/var/www/naro-fashion"
cd "$APP_DIR"

# Captured BEFORE we touch git: the CI step already reset to origin/prod, so
# ORIG_HEAD is the commit that was checked out before this release.
ORIG_HEAD_AT_START="$(git rev-parse -q --verify ORIG_HEAD 2>/dev/null || true)"

PHASE="init"          # init -> building -> swapped -> done | rolled-back
PREDEPLOY_DUMP=""
PREV_SHA=""
GIT_SHA=""

# Minimal helpers until deploy-lib.sh is sourced (after the git reset, so we
# always use the committed version of it).
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }
die() { echo "[$(ts)] ❌ DEPLOY FAILED: $*" >&2; exit 1; }

restore_api_dist() {
  # Undo an in-place API build that never went live: put back the copy of
  # the live dist so disk matches the running process (PM2 may restart it).
  if [ -d apps/api/dist-prev.pending ]; then
    log "↩ restoring apps/api/dist from the pre-build copy"
    rm -rf apps/api/dist
    mv apps/api/dist-prev.pending apps/api/dist
  fi
}

auto_rollback() {
  # Called when the new build is live (PHASE=swapped) but unhealthy, or when
  # anything failed after the swap. Never returns.
  set +e
  PHASE="rolled-back"
  echo "" >&2
  echo "[$(ts)] 🚨🚨🚨 AUTOMATIC ROLLBACK: ${GIT_SHA:0:7} -> ${PREV_SHA:0:7} 🚨🚨🚨" >&2
  local missing
  if ! missing="$(missing_prev_artifacts)"; then
    echo "[$(ts)] ❌ cannot roll back automatically — missing: ${missing//$'\n'/ }" >&2
    pm2 status
    pm2 logs --nostream --lines 40
    print_db_rollback_help "$PREDEPLOY_DUMP"
    exit 1
  fi
  swap_back_artifacts
  restore_source_to "$PREV_SHA" "$GIT_SHA"
  reload_pm2 "$PREV_SHA"
  record_rollback_state "$PREV_SHA" "$GIT_SHA"
  if run_health_checks; then
    echo "[$(ts)] ↩ Rollback is healthy: ${PREV_SHA:0:7} is serving again." >&2
  else
    echo "[$(ts)] ❌❌ Rollback is ALSO unhealthy — manual intervention required NOW." >&2
    pm2 status
    pm2 logs --nostream --lines 40
  fi
  print_db_rollback_help "$PREDEPLOY_DUMP"
  echo "[$(ts)] ❌ DEPLOY FAILED: ${GIT_SHA:0:7} was rolled back (see health-check output above)." >&2
  exit 1
}

on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  case "$PHASE" in
    building)
      restore_api_dist
      echo "[$(ts)] Old build still live and untouched (side builds in apps/*/.next-build discarded on next run)." >&2
      ;;
    swapped)
      auto_rollback
      ;;
  esac
}
trap on_exit EXIT
trap 'echo "[$(ts)] ❌ DEPLOY FAILED at line $LINENO (exit $?) — see output above" >&2' ERR

log "🚀 Deploying Naro Fashion..."

# ---------------------------------------------------------------------------
# 1. Code
# ---------------------------------------------------------------------------
# Pull latest code from prod (the branch CI triggers on — see
# .github/workflows/deploy-prod.yml). Used to be `origin master`, which
# silently undeployed every push for ~3 weeks: CI triggered on prod, ran
# this script, but pulled master which had no new commits. Caught
# 2026-05-10 — see CLAUDE.md "Silent deploys class #2".
git fetch origin prod
git checkout prod
git reset --hard origin/prod

GIT_SHA="$(git rev-parse HEAD)"
export GIT_SHA
log "Now on: ${GIT_SHA:0:7} ($(git log -1 --pretty=%s))"

# shellcheck source=scripts/ops/deploy-lib.sh
. "$APP_DIR/scripts/ops/deploy-lib.sh"

# Assert we are deploying exactly the commit CI verified. Guards against
# a race where a newer push lands between CI verify and this fetch, and
# against the "pulled the wrong branch" class of silent deploys.
if [ -n "${EXPECTED_SHA:-}" ]; then
  if [ "$GIT_SHA" != "$EXPECTED_SHA" ]; then
    die "HEAD is ${GIT_SHA} but CI expected ${EXPECTED_SHA}. A newer push may have landed (its own deploy run will handle it) or the wrong branch was fetched."
  fi
  log "✔ HEAD matches EXPECTED_SHA"
else
  log "⚠ EXPECTED_SHA not set (manual run?) — skipping commit assertion"
fi

# Which commit is live right now (= what an automatic rollback returns to)?
#   1. .deploy/current_sha (written by every successful deploy/rollback)
#   2. the running API's /health `commit` (GIT_SHA env)
#   3. ORIG_HEAD from before the CI step's reset
for candidate in \
    "$(cat "${DEPLOY_STATE_DIR}/current_sha" 2>/dev/null || true)" \
    "$(running_api_commit)" \
    "$ORIG_HEAD_AT_START"; do
  if is_commit "$candidate"; then
    PREV_SHA="$(git rev-parse "${candidate}^{commit}")"
    break
  fi
done
if [ -n "$PREV_SHA" ]; then
  log "Live commit before this deploy: ${PREV_SHA:0:7}"
else
  log "⚠ could not determine the live commit — an automatic rollback will swap builds but NOT reset git"
fi

# ---------------------------------------------------------------------------
# 2. Dependencies — always from the committed lockfile. Never mutate
#    pnpm-lock.yaml on the VPS (see CLAUDE.md "Tracked-file drift").
# ---------------------------------------------------------------------------
pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 3-5. Database
# ---------------------------------------------------------------------------
cd packages/database
pnpm exec prisma generate

# 4. Pre-deploy backup. Re-uses scripts/ops/pg-backup.sh (same pg_dump
#    flags, same dir, same 30-day pruning). BACKUP_TAG=predeploy puts
#    "predeploy" in the filename and suppresses the daily dead-man's-switch
#    ping so a deploy can't mask a missed nightly run.
log "💾 Taking pre-deploy database backup..."
BACKUP_RESULT_FILE="$(mktemp)"
if ! BACKUP_TAG="predeploy-${GIT_SHA:0:7}" BACKUP_RESULT_FILE="$BACKUP_RESULT_FILE" \
     bash "$APP_DIR/scripts/ops/pg-backup.sh"; then
  rm -f "$BACKUP_RESULT_FILE"
  die "pre-deploy pg_dump failed — refusing to touch the schema. Check /root/.pgpass and /var/log/naro-pg-backup.log"
fi
PREDEPLOY_DUMP="$(cat "$BACKUP_RESULT_FILE")"
rm -f "$BACKUP_RESULT_FILE"
if [ -z "$PREDEPLOY_DUMP" ] || [ ! -s "$PREDEPLOY_DUMP" ]; then
  die "pre-deploy dump '${PREDEPLOY_DUMP}' is missing or empty — refusing to touch the schema"
fi
log "✔ Pre-deploy dump: ${PREDEPLOY_DUMP} ($(du -h "$PREDEPLOY_DUMP" | awk '{print $1}'))"
cat <<EOF
------------------------------------------------------------------------
To ROLL BACK the database to the state before this deploy:
  pm2 stop naro-api naro-admin naro-storefront
  sudo -u postgres psql -c "DROP DATABASE naro_fashion;"
  sudo -u postgres psql -c "CREATE DATABASE naro_fashion OWNER naro_admin;"
  PGPASSFILE=/root/.pgpass pg_restore --clean --if-exists --no-owner --no-acl \\
    -h localhost -U naro_admin -d naro_fashion ${PREDEPLOY_DUMP}
  # then re-apply table ownership (docs/OPS/BACKUPS.md "Restoring") and
  # check out + rebuild the previous commit before pm2 restart.
------------------------------------------------------------------------
EOF

# 5. Migrations. Prisma resolves DATABASE_URL from packages/database/.env
#    (the datasource in schema.prisma), so we never parse .env in bash.
#    `db push --accept-data-loss` is GONE: the schema only changes through
#    committed migrations in prisma/migrations/ (docs/OPS/MIGRATIONS.md).

# 5a. One-time baseline. A DB that was managed by `db push` has no
#     _prisma_migrations table; `migrate deploy` would try to run 0_init
#     against existing tables and fail. If (and only if) the live schema is
#     exactly what 0_init describes, mark 0_init as already applied.
PGPASSFILE="${PGPASSFILE:-/root/.pgpass}"
export PGPASSFILE
HAS_MIGRATIONS_TABLE="$(psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-naro_admin}" -d "${DB_NAME:-naro_fashion}" \
  -tAc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>&1)" \
  || die "could not query the database for _prisma_migrations: ${HAS_MIGRATIONS_TABLE}"
HAS_MIGRATIONS_TABLE="$(echo "$HAS_MIGRATIONS_TABLE" | tr -d '[:space:]')"

if [ "$HAS_MIGRATIONS_TABLE" = "f" ]; then
  log "🧱 No _prisma_migrations table — checking the live schema before baselining 0_init..."
  # Compare the live DB against what the 0_init MIGRATION SQL produces (not a
  # schema.prisma snapshot — a commit can carry 0_init AND later schema
  # changes together, which made the old snapshot-based check report false
  # drift). 0_init alone is replayed into a throwaway shadow database.
  INIT_FILE="prisma/migrations/0_init/migration.sql"
  [ -f "$INIT_FILE" ] || die "${INIT_FILE} not found — cannot baseline"
  BASELINE_DIR="$(mktemp -d)"
  mkdir -p "$BASELINE_DIR/migrations/0_init"
  cp "$INIT_FILE" "$BASELINE_DIR/migrations/0_init/"
  cp prisma/migrations/migration_lock.toml "$BASELINE_DIR/migrations/"
  DB_USER_NAME="${DB_USER:-naro_admin}"
  DB_PW="$(awk -F: -v u="$DB_USER_NAME" '$4==u {print $5; exit}' "$PGPASSFILE")"
  [ -n "$DB_PW" ] || die "no password for ${DB_USER_NAME} in ${PGPASSFILE} — cannot create a shadow DB for the baseline check"
  DB_PW_ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$DB_PW")"
  SHADOW_DB="naro_baseline_shadow_$$"
  sudo -u postgres createdb -O "$DB_USER_NAME" "$SHADOW_DB" || die "could not create shadow DB ${SHADOW_DB}"
  SHADOW_URL="postgresql://${DB_USER_NAME}:${DB_PW_ENC}@${DB_HOST:-localhost}:5432/${SHADOW_DB}"
  log "Baseline = prisma/migrations/0_init replayed into shadow DB ${SHADOW_DB}"
  echo "------------------------------------------------------------------------"
  set +e
  pnpm exec prisma migrate diff \
    --from-migrations "$BASELINE_DIR/migrations" \
    --to-schema-datasource prisma/schema.prisma \
    --shadow-database-url "$SHADOW_URL" \
    --script --exit-code
  DRIFT_RC=$?
  set -e
  sudo -u postgres dropdb --if-exists "$SHADOW_DB" || log "⚠ could not drop shadow DB ${SHADOW_DB} — drop it by hand"
  rm -rf "$BASELINE_DIR"
  echo "------------------------------------------------------------------------"
  case "$DRIFT_RC" in
    0)
      log "✔ Live schema matches 0_init exactly — marking 0_init as applied (no SQL is executed)"
      pnpm exec prisma migrate resolve --applied 0_init
      ;;
    2)
      die "DRIFT: the live database differs from the 0_init baseline (SQL above = what it would take to make the DB match). NOT baselining and NOT auto-pushing. Reconcile by hand — see docs/OPS/MIGRATIONS.md 'First deploy / drift' — then re-run deploy.sh."
      ;;
    *)
      die "prisma migrate diff errored (exit ${DRIFT_RC}) while checking for drift — refusing to baseline."
      ;;
  esac
elif [ "$HAS_MIGRATIONS_TABLE" != "t" ]; then
  die "unexpected answer when checking for _prisma_migrations: '${HAS_MIGRATIONS_TABLE}'"
fi

# 5b. Apply pending committed migrations (forward-only).
log "🔍 Migration status before deploy:"
pnpm exec prisma migrate status || true   # non-zero just means "pending"
log "🗄  prisma migrate deploy..."
pnpm exec prisma migrate deploy

# 5c. Drift guard: after migrating, the DB must match schema.prisma. A
#     non-empty diff means someone changed schema.prisma without running
#     `prisma migrate dev` — the new code would then hit missing columns.
#     Abort BEFORE building/swapping so the old (compatible) code stays live.
set +e
pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script --exit-code
POST_DRIFT_RC=$?
set -e
case "$POST_DRIFT_RC" in
  0) log "✔ Database matches schema.prisma after migrate deploy" ;;
  2) die "schema.prisma has changes with NO migration (SQL above). Run 'pnpm prisma migrate dev --name <x>' locally, commit the migration, redeploy. Old build is still live." ;;
  *) die "prisma migrate diff errored (exit ${POST_DRIFT_RC}) during the post-migrate drift check." ;;
esac
cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 6. Build — SEQUENTIALLY and to the SIDE. Root `pnpm build` fans out via
#    Turbo in parallel and gets OOM-killed on the 2GB VPS (CLAUDE.md "2GB
#    VPS + parallel Turbo builds"). Next apps build into .next-build
#    (next.config.js honours NEXT_DIST_DIR), so the live .next is untouched
#    if a build dies half-way. packages/shared + packages/ui have no build.
# ---------------------------------------------------------------------------
PHASE="building"

# API: `nest build` (deleteOutDir) rebuilds dist in place. Keep a copy of the
# live dist first; it is restored if anything fails before the swap and
# becomes dist-prev at swap time. The running API keeps its code in memory.
log "🔨 Building api..."
rm -rf apps/api/dist-prev.pending
if [ -d apps/api/dist ]; then
  cp -a apps/api/dist apps/api/dist-prev.pending
fi
if ! pnpm --filter api build || [ ! -f apps/api/dist/main.js ]; then
  die "api build failed or did not produce apps/api/dist/main.js (live dist restored)"
fi

verify_next_build() {
  local app="$1"
  local dir="apps/${app}/.next-build"
  for f in BUILD_ID routes-manifest.json; do
    [ -s "${dir}/${f}" ] || die "${app} build is incomplete: ${dir}/${f} missing (OOM-killed?). Live build untouched; NOT restarting."
  done
  log "✔ ${app} build verified (BUILD_ID $(cat "${dir}/BUILD_ID"))"
}

for app in "${NEXT_APPS[@]}"; do
  log "🔨 Building ${app} into apps/${app}/.next-build..."
  rm -rf "apps/${app}/.next-build"
  # Seed the webpack cache from the live build so the side build isn't cold.
  if [ -d "apps/${app}/.next/cache" ]; then
    mkdir -p "apps/${app}/.next-build"
    cp -a "apps/${app}/.next/cache" "apps/${app}/.next-build/cache" || true
  fi
  NEXT_DIST_DIR=.next-build pnpm --filter "$app" build
  verify_next_build "$app"
done
# NOTE: the old "sync static+public into .next/standalone" step was dropped.
# PM2 runs `next start` (serves apps/<app>/.next), never the standalone
# server.js, and a standalone bundle built with NEXT_DIST_DIR=.next-build
# would hard-code that dir name anyway. If ecosystem.config.js is ever
# switched to standalone, revisit this.

# ---------------------------------------------------------------------------
# 7. Swap + reload. Everything built and verified; from here on any failure
#    triggers an automatic rollback (PHASE=swapped -> on_exit).
# ---------------------------------------------------------------------------
log "🔁 Swapping new builds into place..."
PHASE="swapped"
mkdir -p "$DEPLOY_STATE_DIR"
CAN_ROLLBACK=1
for app in "${NEXT_APPS[@]}"; do
  d="apps/${app}"
  rm -rf "${d}/.next-prev"
  if [ -d "${d}/.next" ]; then mv "${d}/.next" "${d}/.next-prev"; else CAN_ROLLBACK=0; fi
  mv "${d}/.next-build" "${d}/.next"
done
rm -rf apps/api/dist-prev
if [ -d apps/api/dist-prev.pending ]; then
  mv apps/api/dist-prev.pending apps/api/dist-prev
else
  CAN_ROLLBACK=0
fi
if [ "$CAN_ROLLBACK" -eq 1 ] && [ -n "$PREV_SHA" ]; then
  printf '%s\n' "$PREV_SHA" > "${DEPLOY_STATE_DIR}/previous_sha"
else
  rm -f "${DEPLOY_STATE_DIR}/previous_sha"
  log "⚠ no complete previous build to keep — rollback will not be possible for this release"
fi
printf '%s\n' "$GIT_SHA" > "${DEPLOY_STATE_DIR}/current_sha"

# All apps are fork mode (instances: 1), so `pm2 reload` is effectively a
# restart (brief downtime per app). --update-env pushes GIT_SHA into each
# process env so GET /api/v1/health can report the running commit.
reload_pm2 "$GIT_SHA"

# ---------------------------------------------------------------------------
# 8. Health checks — roll back automatically if the new code isn't serving.
# ---------------------------------------------------------------------------
log "🩺 Running post-deploy health checks..."
if ! run_health_checks; then
  pm2 status || true
  pm2 logs --nostream --lines 40 || true
  auto_rollback   # never returns; exits 1
fi

# Soft check: does /health report the commit we just deployed?
HEALTH_BODY="$(curl -s --max-time 5 http://127.0.0.1:4000/api/v1/health || true)"
if [ -n "$HEALTH_BODY" ]; then
  if echo "$HEALTH_BODY" | grep -q "${GIT_SHA:0:7}"; then
    log "✔ /health reports the deployed commit"
  else
    log "⚠ /health body does not mention ${GIT_SHA:0:7}: ${HEALTH_BODY:0:300}"
  fi
fi

PHASE="done"
rm -f "${DEPLOY_STATE_DIR}/rolled_back_from"
log "✅ Deployment complete: ${GIT_SHA:0:7} (previous build kept for 'bash scripts/ops/rollback.sh': ${PREV_SHA:0:7})"
