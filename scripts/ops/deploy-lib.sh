#!/usr/bin/env bash
# Shared helpers for deploy.sh and scripts/ops/rollback.sh.
# Sourced, never executed directly. Expects the caller to `cd "$APP_DIR"`.
#
# Artifact layout on the VPS (all gitignored):
#   apps/<app>/.next          build PM2 serves (`next start` from apps/<app>)
#   apps/<app>/.next-prev.pending  copy of the live .next taken before the
#                             in-place build; restored if the build fails
#   apps/<app>/.next-prev     build that was live before the last deploy
#   apps/<app>/.next-failed   build that was swapped OUT by a rollback (debug)
#   apps/api/dist             build PM2 serves (dist/main.js)
#   apps/api/dist-prev        API build that was live before the last swap
#   apps/api/dist-prev.pending  copy of the live dist taken before building;
#                             promoted to dist-prev only at swap time, so
#                             dist-prev always pairs with .next-prev
#   apps/api/dist-failed      API build swapped OUT by a rollback (debug)
#   .deploy/current_sha       commit whose build is live
#   .deploy/previous_sha      commit whose build is in the *-prev dirs
#   .deploy/rolled_back_from  commit that the last rollback moved away from

NEXT_APPS=(storefront admin)
DEPLOY_STATE_DIR=".deploy"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }
warn() { echo "[$(ts)] ⚠ $*" >&2; }

# ---------------------------------------------------------------------------
# Health checks
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

storefront_health_host() {
  # The storefront middleware 404s unknown Hosts in production (127.0.0.1
  # included), so probe with a real tenant host: first entry of
  # STOREFRONT_DEFAULT_HOSTS in the storefront env, else the apex domain.
  local h
  h="$(grep -E '^STOREFRONT_DEFAULT_HOSTS=' apps/storefront/.env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | cut -d, -f1 || true)"
  echo "${h:-narofashion.co.tz}"
}

check_static_asset() {
  # check_static_asset <name> <page-url> [host-header]
  # A page can return 200 while every /_next/static asset 404s (unstyled,
  # non-interactive site) — exactly what happened on 2026-10-04 when builds
  # were renamed after `next build` baked in a different distDir. Fetch the
  # page, pick the first CSS (else JS) asset it references, require 200.
  local name="$1" url="$2" host="${3:-}"
  local host_args=()
  [ -n "$host" ] && host_args=(-H "Host: ${host}")
  local base="${url%/*}" asset code
  asset="$(curl -s --max-time 10 "${host_args[@]}" "$url" \
    | grep -oE '/_next/static/[^"\\ ]+\.(css|js)' | sort -r | head -1 || true)"
  if [ -z "$asset" ]; then
    echo "[$(ts)] ✖ ${name}: page references no /_next/static asset" >&2
    return 1
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${host_args[@]}" "${base}${asset}" || true)"
  if [ "$code" = "200" ]; then
    log "✔ ${name} static assets served (${asset} -> 200)"
    return 0
  fi
  echo "[$(ts)] ✖ ${name} static asset ${asset} -> ${code} (site would render unstyled)" >&2
  return 1
}

run_health_checks() {
  # Returns 0 when api, storefront and admin all answer AND serve their
  # /_next/static assets; 1 otherwise.
  local rc=0 host
  host="$(storefront_health_host)"
  wait_for "api"        "http://127.0.0.1:4000/api/v1/health" '^200$'             60 || rc=1
  wait_for "storefront" "http://127.0.0.1:3000/"              '^(2|3)[0-9][0-9]$' 60 "$host" || rc=1
  wait_for "admin"      "http://127.0.0.1:3001/"              '^(2|3)[0-9][0-9]$' 60 || rc=1
  check_static_asset "storefront" "http://127.0.0.1:3000/" "$host" || rc=1
  check_static_asset "admin"      "http://127.0.0.1:3001/login"    || rc=1
  return "$rc"
}

running_api_commit() {
  # Commit reported by the live API's /health (GIT_SHA env), or empty.
  curl -s --max-time 5 http://127.0.0.1:4000/api/v1/health 2>/dev/null \
    | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p' || true
}

is_commit() { [ -n "${1:-}" ] && git cat-file -e "${1}^{commit}" 2>/dev/null; }

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
missing_prev_artifacts() {
  # Prints each missing *-prev artifact; returns 0 when NOTHING is missing.
  local missing=0 app
  for app in "${NEXT_APPS[@]}"; do
    if [ ! -s "apps/${app}/.next-prev/BUILD_ID" ]; then
      echo "apps/${app}/.next-prev"; missing=1
    fi
  done
  if [ ! -f apps/api/dist-prev/main.js ]; then
    echo "apps/api/dist-prev"; missing=1
  fi
  return "$missing"
}

swap_back_artifacts() {
  # Moves the *-prev builds back into the serving paths. The build being
  # replaced is kept as .next-failed / dist-failed for post-mortem.
  local app d
  for app in "${NEXT_APPS[@]}"; do
    d="apps/${app}"
    rm -rf "${d}/.next-failed"
    if [ -d "${d}/.next" ]; then mv "${d}/.next" "${d}/.next-failed"; fi
    mv "${d}/.next-prev" "${d}/.next"
    log "↩ ${app}: .next-prev -> .next (BUILD_ID $(cat "${d}/.next/BUILD_ID"))"
  done
  rm -rf apps/api/dist-failed
  if [ -d apps/api/dist ]; then mv apps/api/dist apps/api/dist-failed; fi
  mv apps/api/dist-prev apps/api/dist
  log "↩ api: dist-prev -> dist"
}

restore_source_to() {
  # restore_source_to <sha> <sha-being-left>
  # Puts the working tree (and therefore ecosystem.config.js, node_modules
  # and the generated Prisma client) back in line with the build that is
  # now in the serving paths.
  local target="$1" leaving="${2:-}"
  if ! is_commit "$target"; then
    warn "previous SHA '${target}' is unknown — NOT resetting git. Source tree no longer matches the running build; fix by hand."
    return 0
  fi
  log "↩ git reset --hard ${target:0:7}"
  git reset --hard "$target"
  if [ -n "$leaving" ] && is_commit "$leaving" && git diff --quiet "$leaving" "$target" -- pnpm-lock.yaml; then
    log "lockfile unchanged between ${leaving:0:7} and ${target:0:7} — skipping pnpm install"
  else
    log "↩ pnpm install --frozen-lockfile (dependencies of ${target:0:7})"
    pnpm install --frozen-lockfile || warn "pnpm install failed during rollback — continuing"
  fi
  # Regenerate the client from the OLD schema. Safe against the (newer)
  # migrated DB because migrations must be backward compatible (additive).
  (cd packages/database && pnpm exec prisma generate) || warn "prisma generate failed during rollback — continuing"
}

reload_pm2() {
  # reload_pm2 <git-sha-to-advertise>
  log "♻️  Reloading PM2 processes (GIT_SHA=${1:0:7})..."
  GIT_SHA="$1" pm2 reload ecosystem.config.js --update-env
  pm2 save || warn "pm2 save failed (non-fatal)"
}

record_rollback_state() {
  # record_rollback_state <now-live-sha> <rolled-back-from-sha>
  mkdir -p "$DEPLOY_STATE_DIR"
  if [ -n "${1:-}" ]; then printf '%s\n' "$1" > "${DEPLOY_STATE_DIR}/current_sha"; fi
  printf '%s\n' "${2:-unknown}" > "${DEPLOY_STATE_DIR}/rolled_back_from"
  # The *-prev dirs were consumed by the swap: there is nothing left to roll
  # back to until the next successful deploy.
  rm -f "${DEPLOY_STATE_DIR}/previous_sha"
}

print_db_rollback_help() {
  # print_db_rollback_help <dump-path>
  cat >&2 <<EOF
------------------------------------------------------------------------
The DATABASE was NOT rolled back. Migrations are forward-only and must be
backward compatible (expand/contract — docs/OPS/MIGRATIONS.md), so the
previous code should run against the migrated schema.
Only if it does not, restore the pre-deploy dump:
  pm2 stop naro-api naro-admin naro-storefront
  sudo -u postgres psql -c "DROP DATABASE naro_fashion;"
  sudo -u postgres psql -c "CREATE DATABASE naro_fashion OWNER naro_admin;"
  PGPASSFILE=/root/.pgpass pg_restore --clean --if-exists --no-owner --no-acl \\
    -h localhost -U naro_admin -d naro_fashion ${1:-<pre-deploy dump in /var/backups/naro/postgres/>}
  # re-apply table ownership (docs/OPS/BACKUPS.md "Restoring"), then
  pm2 restart all
------------------------------------------------------------------------
EOF
}
