#!/usr/bin/env bash
# Naro Fashion production deploy.
#
# Invoked by .github/workflows/deploy-prod.yml (after the `verify` job is
# green) as:   EXPECTED_SHA=<github.sha> bash deploy.sh
# Can also be run by hand on the VPS:   bash deploy.sh
#
# Stages (each one aborts the deploy on failure — `set -euo pipefail`):
#   1. git fetch + hard reset to origin/prod, assert HEAD == $EXPECTED_SHA
#   2. pnpm install --frozen-lockfile
#   3. prisma generate
#   4. PRE-DEPLOY DATABASE BACKUP (abort if the dump fails / is empty)
#   5. print the schema diff, then prisma db push
#   6. sequential builds (api -> storefront -> admin) to dodge the 2GB OOM,
#      verifying each Next build produced a complete .next dir
#   7. pm2 reload with GIT_SHA in the env
#   8. post-deploy health checks (API /health, storefront, admin)
#
# NOTE on partial-build risk: `next build` wipes apps/<app>/.next at the
# start, so a build that fails half-way leaves the still-running
# `next start` process pointing at an incomplete dir. The verify step below
# stops us from *restarting* onto a broken build and makes the deploy exit
# non-zero (CI goes red), but the operator must then fix + redeploy (or
# rebuild the previous commit). Building into a temp distDir and swapping
# atomically is the long-term fix; out of scope for now.

set -euo pipefail

APP_DIR="/var/www/naro-fashion"
BACKUP_DIR="/var/backups/naro/postgres"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }
die() { echo "[$(ts)] ❌ DEPLOY FAILED: $*" >&2; exit 1; }

trap 'echo "[$(ts)] ❌ DEPLOY FAILED at line $LINENO (exit $?) — see output above" >&2' ERR

log "🚀 Deploying Naro Fashion..."
cd "$APP_DIR"

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

# 5. Show exactly what `db push` is about to do. Uses the datasource URL
#    from schema.prisma (Prisma resolves DATABASE_URL from its own .env, so
#    we don't have to parse .env files in bash). Informational only — a
#    diff failure must not block the deploy.
log "🔍 Schema changes about to be applied (prisma migrate diff):"
echo "------------------------------------------------------------------------"
pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script || log "⚠ prisma migrate diff failed (non-fatal) — inspect manually"
echo "------------------------------------------------------------------------"

# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# WARNING: --accept-data-loss is still ON.
# It is kept deliberately for now: a pending deploy adds composite
# @@unique constraints, which Prisma classifies as "possible data loss"
# warnings — without the flag, `db push` refuses and blocks that deploy.
# The safety net is the pre-deploy dump above + the diff printed above.
# TODO: switch to `prisma migrate deploy` with committed migrations and
#       drop this flag. Until then, READ THE DIFF ABOVE in the deploy log
#       for any DROP COLUMN / DROP TABLE before declaring the deploy good.
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
pnpm exec prisma db push --accept-data-loss
cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 6. Build — SEQUENTIALLY. Root `pnpm build` fans out via Turbo in
#    parallel and gets OOM-killed on the 2GB VPS, silently leaving an
#    incomplete .next dir (CLAUDE.md "2GB VPS + parallel Turbo builds").
#    Package names: api / storefront / admin (see each apps/*/package.json).
#    packages/shared + packages/ui have no build step (main: src/index.ts).
# ---------------------------------------------------------------------------
log "🔨 Building api..."
pnpm --filter api build
[ -f apps/api/dist/main.js ] || die "api build did not produce apps/api/dist/main.js"

verify_next_build() {
  local app="$1"
  local dir="apps/${app}/.next"
  for f in BUILD_ID routes-manifest.json; do
    [ -s "${dir}/${f}" ] || die "${app} build is incomplete: ${dir}/${f} missing (OOM-killed?). Old processes still running; NOT restarting."
  done
  log "✔ ${app} build verified (BUILD_ID $(cat "${dir}/BUILD_ID"))"
}

for app in storefront admin; do
  log "🔨 Building ${app}..."
  pnpm --filter "$app" build
  verify_next_build "$app"
done

# Static/public sync into the standalone output.
# PM2 (ecosystem.config.js) runs `next start` from apps/<app>, i.e. it
# serves apps/<app>/.next directly — it does NOT run the standalone
# server.js, so this copy is not on the serving path today. It is kept
# (harmless, cheap) so that switching ecosystem.config.js to
# `.next/standalone/apps/<app>/server.js` later works without a ChunkLoadError.
for app in storefront admin; do
  standalone_dir="apps/${app}/.next/standalone/apps/${app}"
  if [ -d "${standalone_dir}" ]; then
    log "📦 Syncing static + public into standalone dir for ${app} (not served by PM2 today)"
    rm -rf "${standalone_dir}/.next/static" "${standalone_dir}/public"
    cp -r "apps/${app}/.next/static" "${standalone_dir}/.next/static"
    if [ -d "apps/${app}/public" ]; then
      cp -r "apps/${app}/public" "${standalone_dir}/public"
    fi
  fi
done

# ---------------------------------------------------------------------------
# 7. Restart. All apps are fork mode (instances: 1), so `pm2 reload` is
#    effectively a restart (brief downtime per app) — it does NOT give a
#    zero-downtime swap. --update-env pushes GIT_SHA into each process env
#    so GET /api/v1/health can report the running commit.
# ---------------------------------------------------------------------------
log "♻️  Reloading PM2 processes (GIT_SHA=${GIT_SHA:0:7})..."
GIT_SHA="$GIT_SHA" pm2 reload ecosystem.config.js --update-env
pm2 save || log "⚠ pm2 save failed (non-fatal)"

# ---------------------------------------------------------------------------
# 8. Health checks — fail the deploy loudly if the new code isn't serving.
# ---------------------------------------------------------------------------
wait_for() {
  # wait_for <name> <url> <accepted-status-regex> <timeout-seconds> [host-header]
  local name="$1" url="$2" ok_re="$3" timeout="$4" host="${5:-}"
  local deadline=$(( $(date +%s) + timeout ))
  local code="000"
  local host_args=()
  [ -n "$host" ] && host_args=(-H "Host: ${host}")
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${host_args[@]}" "$url" || true)"
    if [[ "$code" =~ $ok_re ]]; then
      log "✔ ${name} healthy (${url} -> ${code})"
      return 0
    fi
    sleep 3
  done
  echo "[$(ts)] ✖ ${name} NOT healthy after ${timeout}s (${url} -> last status ${code})" >&2
  return 1
}

log "🩺 Running post-deploy health checks..."
HEALTH_OK=1
wait_for "api"        "http://127.0.0.1:4000/api/v1/health" '^200$'        60 || HEALTH_OK=0
# The storefront middleware 404s unknown Hosts in production (127.0.0.1
# included), so probe with a real tenant host: first entry of
# STOREFRONT_DEFAULT_HOSTS in the storefront env, else the apex domain.
STOREFRONT_HEALTH_HOST="$(grep -E '^STOREFRONT_DEFAULT_HOSTS=' apps/storefront/.env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | cut -d, -f1)"
STOREFRONT_HEALTH_HOST="${STOREFRONT_HEALTH_HOST:-narofashion.co.tz}"
wait_for "storefront" "http://127.0.0.1:3000/"              '^(2|3)[0-9][0-9]$' 60 "$STOREFRONT_HEALTH_HOST" || HEALTH_OK=0
wait_for "admin"      "http://127.0.0.1:3001/"              '^(2|3)[0-9][0-9]$' 60 || HEALTH_OK=0

# Soft check: does /health report the commit we just deployed?
HEALTH_BODY="$(curl -s --max-time 5 http://127.0.0.1:4000/api/v1/health || true)"
if [ -n "$HEALTH_BODY" ]; then
  if echo "$HEALTH_BODY" | grep -q "${GIT_SHA:0:7}"; then
    log "✔ /health reports the deployed commit"
  else
    log "⚠ /health body does not mention ${GIT_SHA:0:7}: ${HEALTH_BODY:0:300}"
  fi
fi

if [ "$HEALTH_OK" -ne 1 ]; then
  pm2 status || true
  pm2 logs --nostream --lines 40 || true
  die "post-deploy health checks failed (code ${GIT_SHA:0:7} is installed but not serving correctly). Pre-deploy DB dump: ${PREDEPLOY_DUMP}"
fi

log "✅ Deployment complete: ${GIT_SHA:0:7}"
