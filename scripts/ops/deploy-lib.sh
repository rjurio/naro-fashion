#!/usr/bin/env bash
# Shared helpers for deploy.sh and scripts/ops/rollback.sh.
# Sourced, never executed directly. Expects the caller to `cd "$APP_DIR"`.
#
# Artifact layout on the VPS (all gitignored):
#   apps/<app>/.next          build PM2 serves (standalone server.js inside it)
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

# PM2 supervision guard (pm2_supervision_check). Every pm2 command in the
# deploy/rollback scripts goes through reload_pm2 or pm2_diagnostics below,
# both of which run the guard first — a bare `pm2 ...` would spawn an
# unsupervised daemon if pm2-root.service's daemon were gone.
# shellcheck source=scripts/ops/pm2-guard.sh
. "$(dirname "${BASH_SOURCE[0]}")/pm2-guard.sh"

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
  # Returns 1 if ANY move failed (builds may then be mixed — caller must stop).
  local app d rc=0
  for app in "${NEXT_APPS[@]}"; do
    d="apps/${app}"
    rm -rf "${d}/.next-failed"
    if [ -d "${d}/.next" ]; then mv "${d}/.next" "${d}/.next-failed" || rc=1; fi
    if mv "${d}/.next-prev" "${d}/.next"; then
      log "↩ ${app}: .next-prev -> .next (BUILD_ID $(cat "${d}/.next/BUILD_ID" 2>/dev/null))"
    else
      warn "${app}: could not move .next-prev back to .next"; rc=1
    fi
  done
  rm -rf apps/api/dist-failed
  if [ -d apps/api/dist ]; then mv apps/api/dist apps/api/dist-failed || rc=1; fi
  if mv apps/api/dist-prev apps/api/dist; then log "↩ api: dist-prev -> dist"; else warn "api: could not move dist-prev back to dist"; rc=1; fi
  return "$rc"
}

# Deploy tooling that must never be rolled back to a pre-guard version.
DEPLOY_TOOLING=(deploy.sh scripts/ops/deploy-lib.sh scripts/ops/rollback.sh scripts/ops/pm2-guard.sh scripts/ops/tests/pm2-guard.test.sh)

has_pm2_guard() { is_commit "${1:-}" && git cat-file -e "${1}:scripts/ops/pm2-guard.sh" 2>/dev/null; }
# The commit's guard knows the NARO OS-user mode (/etc/naro-pm2.env).
has_os_user_guard() { has_pm2_guard "${1:-}" && git cat-file -p "${1}:scripts/ops/pm2-guard.sh" 2>/dev/null | grep -q 'NARO_PM2_USER'; }
# Tooling at <sha> can't serve this server: no guard, or OS-user mode is ON
# and its guard predates it (it would refuse every pm2 command, fail closed).
tooling_unfit_for() {
  ! has_pm2_guard "${1:-}" && return 0
  _pm2g_naro_conf
  [ "${_PG_NARO_MODE:-0}" = "1" ] && ! has_os_user_guard "${1:-}"
}

restore_source_to() {
  # restore_source_to <sha> <sha-being-left>
  # Puts the working tree (and therefore ecosystem.config.js, node_modules
  # and the generated Prisma client) back in line with the build that is
  # now in the serving paths. Returns 1 if ANY step failed — the caller must
  # then report the rollback as incomplete, never as successful.
  #
  # Rolling back APPLICATION code never removes the PM2 guard: if <sha>
  # predates scripts/ops/pm2-guard.sh, the deploy tooling (DEPLOY_TOOLING) is
  # re-checked-out from <sha-being-left>, so the next deploy/rollback is still
  # guarded. `git status` then shows those files as modified on purpose
  # (.deploy/tooling_from records where they came from); the next deploy's
  # `git reset --hard origin/prod` clears it. Removing the guard itself is a
  # separate, explicitly authorised procedure (docs/OPS/DEPLOY.md).
  local target="$1" leaving="${2:-}" rc=0 f
  if ! is_commit "$target"; then
    warn "previous SHA '${target}' is unknown — NOT resetting git. Source tree no longer matches the running build."
    return 1
  fi
  log "↩ git reset --hard ${target:0:7}"
  git reset --hard "$target" || { warn "git reset --hard ${target:0:7} failed"; return 1; }
  rm -f "${DEPLOY_STATE_DIR}/tooling_from"
  if tooling_unfit_for "$target"; then
    if ! tooling_unfit_for "$leaving"; then
      for f in "${DEPLOY_TOOLING[@]}"; do
        if git cat-file -e "${leaving}:${f}" 2>/dev/null; then
          git checkout "$leaving" -- "$f" || { warn "could not keep guarded tooling ${f} from ${leaving:0:7}"; rc=1; }
        fi
      done
      mkdir -p "$DEPLOY_STATE_DIR"
      printf '%s\n' "$leaving" > "${DEPLOY_STATE_DIR}/tooling_from"
      log "🛡  ${target:0:7} predates the PM2 guard (or its OS-user mode): application code is ${target:0:7}, deploy tooling kept from ${leaving:0:7} (guard retained)"
    else
      warn "${target:0:7} predates the PM2 guard (or its OS-user mode) and no fitting tooling is available to keep — the checkout is now UNGUARDED or unusable here"
      rc=1
    fi
  fi
  if [ -n "$leaving" ] && is_commit "$leaving" && git diff --quiet "$leaving" "$target" -- pnpm-lock.yaml; then
    log "lockfile unchanged between ${leaving:0:7} and ${target:0:7} — skipping pnpm install"
  else
    log "↩ pnpm install --frozen-lockfile (dependencies of ${target:0:7})"
    pnpm install --frozen-lockfile || { warn "pnpm install failed during rollback"; rc=1; }
  fi
  # Regenerate the client from the OLD schema. Safe against the (newer)
  # migrated DB because migrations must be backward compatible (additive).
  (cd packages/database && pnpm exec prisma generate) || { warn "prisma generate failed during rollback"; rc=1; }
  return "$rc"
}

reload_pm2() {
  # reload_pm2 <git-sha-to-advertise>
  # The Next apps get a HARD restart: their workers run from inside
  # apps/<app>/.next/standalone, and after .next is swapped/rebuilt a graceful
  # cluster `reload` can leave the old worker serving from the moved dir
  # (2026-10-04: admin kept 404ing every asset until `pm2 restart`). The API
  # (dist/main.js, no dir swap) keeps the graceful reload.
  # Only the three NARO apps are named — never 'all' (shared VPS).
  # Returns 1 WITHOUT touching pm2 when supervision can't be verified, and
  # stops at the first refused/failed pm2 command (caller reports it).
  log "🛡  Verifying PM2 supervision immediately before the first pm2 command..."
  if ! pm2_supervision_check; then
    warn "PM2 NOT reloaded: supervision check failed (see above)"
    return 1
  fi
  if ! naro_fs_modes; then
    warn "PM2 NOT reloaded: the NARO account's file modes could not be set (see above)"
    return 1
  fi
  log "♻️  Restarting PM2 processes (GIT_SHA=${1:0:7})..."
  GIT_SHA="$1" pm2_guarded reload ecosystem.config.js --only naro-api --update-env \
    || { warn "PM2 NOT reloaded: 'pm2 reload naro-api' refused or failed"; return 1; }
  GIT_SHA="$1" pm2_guarded restart ecosystem.config.js --only naro-storefront,naro-admin --update-env \
    || { warn "PM2 only PARTLY reloaded: naro-api done, 'pm2 restart naro-storefront,naro-admin' refused or failed"; return 1; }
  pm2_guarded save || warn "pm2 save failed or was refused (non-fatal)"
}

pm2_guarded() {
  # pm2_guarded <pm2 args...>: the ONLY way these scripts run a mutating pm2
  # command. Re-verifies supervision right before EACH call, so a daemon that
  # vanished after the previous command can't be silently re-spawned by the
  # next one. (A residual window of milliseconds between check and exec
  # remains; pm2 has no "never spawn a daemon" switch.)
  if ! pm2_supervision_check --quiet; then
    warn "refusing 'pm2 $*': PM2 supervision check failed (see above)"
    return 1
  fi
  naro_pm2 "$@"
}

naro_pm2() {
  # naro_pm2 <pm2 args...>: run pm2 against the daemon that supervises the
  # NARO apps. Root-only mode: the root daemon (as before). OS-user mode
  # (/etc/naro-pm2.env): the dedicated account's daemon, through sudo, whose
  # environment reset means ONLY PATH, PM2_HOME and GIT_SHA reach it — no root
  # variable or secret can be copied into the apps by --update-env.
  # Callers: pm2_guarded and pm2_diagnostics only (both check the guard first).
  _pm2g_naro_conf
  if [ "${_PG_NARO_MODE:-0}" = "1" ]; then
    sudo -u "$_PG_NARO_USER" -H env PATH="${_PG_NARO_PATH}" PM2_HOME="$_PG_NARO_HOME" \
      ${GIT_SHA:+GIT_SHA="$GIT_SHA"} pm2 "$@"
  else
    pm2 "$@"
  fi
}

naro_pm2_hint() {
  # The prefix an operator types for a NARO pm2 command (printed in help text only).
  _pm2g_naro_conf
  if [ "${_PG_NARO_MODE:-0}" = "1" ]; then
    printf 'sudo -u %s -H env PM2_HOME=%s ' "$_PG_NARO_USER" "$_PG_NARO_HOME"
  fi
}

_osu() {
  # _osu <command...>: a file-ownership/mode command. Self-test: logged, not run.
  if [ "${PM2_GUARD_TEST:-}" = "1" ] && [ -n "${PM2_GUARD_FS_LOG:-}" ]; then
    echo "$*" >> "$PM2_GUARD_FS_LOG"
    return 0
  fi
  "$@"
}

naro_fs_modes() {
  # OS-user mode only: before every reload, re-assert what the NARO account
  # may touch. Code and builds stay root-owned (the apps can't change them);
  # the three .env files are root:<user> 640 (read, never write); uploads,
  # private uploads (ID documents, 700) and the Next standalone caches belong
  # to the account. Returns 1 on any failure (the caller does NOT reload).
  _pm2g_naro_conf
  [ "${_PG_NARO_MODE:-0}" = "1" ] || return 0
  local u="$_PG_NARO_USER" rc=0 f d priv
  for f in .env apps/api/.env packages/database/.env; do
    [ -f "$f" ] || continue
    _osu chown "root:${u}" "$f" && _osu chmod 640 "$f" || { warn "could not set root:${u} 640 on ${f}"; rc=1; }
  done
  priv="$(sed -n 's/^PRIVATE_UPLOAD_DIR=//p' apps/api/.env 2>/dev/null | head -1 | tr -d '"')"
  priv="${priv:-apps/api/private-uploads}"
  case "$priv" in /*) ;; *) priv="${PWD}/${priv}" ;; esac
  for d in apps/api/uploads "$priv"; do
    _osu mkdir -p "$d" && _osu chown -R "${u}:${u}" "$d" || { warn "could not give ${d} to ${u}"; rc=1; }
  done
  _osu chmod 700 "$priv" || rc=1
  for d in apps/storefront/.next/standalone/apps/storefront/.next/cache apps/admin/.next/standalone/apps/admin/.next/cache; do
    [ -d "$(dirname "$d")" ] || continue
    _osu mkdir -p "$d" && _osu chown -R "${u}:${u}" "$d" || { warn "could not give ${d} to ${u}"; rc=1; }
  done
  for f in deploy.sh ecosystem.config.js apps/api/dist; do
    [ -e "$f" ] || continue
    if [ "$(stat -c %U "$f" 2>/dev/null)" = "$u" ]; then warn "${f} is owned by ${u}: code must stay root-owned"; rc=1; fi
  done
  [ "$rc" -eq 0 ] && log "🔒 File modes for ${u}: .env 640 root:${u}, uploads + private uploads + Next caches ${u}, code root-owned"
  return "$rc"
}

rollback_incomplete_notice() {
  # rollback_incomplete_notice <rollback-target-sha> <what went wrong>
  # A rollback did not fully succeed. Printed with echo (not a heredoc) so
  # nothing in it can execute. Callers exit 3 after it.
  local sha="${1:-<previous sha>}" reason="${2:-see above}" pfx
  pfx="$(naro_pm2_hint)"
  {
    echo "========================================================================"
    echo "❌ ROLLBACK INCOMPLETE — OPERATOR INTERVENTION REQUIRED"
    echo "Rollback target: ${sha:0:7}. Problem: ${reason}."
    echo "What is serving traffic right now is NOT verified. Do not treat this"
    echo "rollback as successful."
    echo "  1. Do NOT re-run deploy.sh or rollback.sh: the *-prev builds were consumed."
    echo "  2. cd /var/www/naro-fashion && bash scripts/ops/pm2-guard.sh   # must PASS"
    echo "     If it fails: do NOT run pm2 from this shell; recover ${PM2_GUARD_UNIT}"
    echo "     through systemd (docs/OPS/DEPLOY.md 'PM2 supervision guard')."
    echo "  3. Fix the problem above (builds in apps/*/.next + apps/api/dist, git at"
    echo "     ${sha:0:7}, pnpm install / prisma generate), then reload ONLY NARO:"
    echo "     ${pfx}GIT_SHA=${sha} pm2 reload ecosystem.config.js --only naro-api --update-env"
    echo "     ${pfx}GIT_SHA=${sha} pm2 restart ecosystem.config.js --only naro-storefront,naro-admin --update-env"
    echo "     ${pfx}pm2 save        (never 'pm2 restart all' — other apps share this daemon)"
    echo "  4. curl -s http://127.0.0.1:4000/api/v1/health   # 'commit' must be ${sha:0:7}"
    echo "     + storefront (Host: narofashion.co.tz), admin /login, one /_next/static asset each."
    echo "========================================================================"
  } >&2
}

pm2_diagnostics() {
  # `pm2 status` + recent logs for failure output — only when supervision is
  # verified (these read-only commands would also spawn a daemon). Never fails.
  if pm2_supervision_check --quiet 2>/dev/null; then
    naro_pm2 status || true
    naro_pm2 logs --nostream --lines 40 || true
  else
    warn "skipping 'pm2 status' / 'pm2 logs': PM2 supervision is not verified (running pm2 now could start an unsupervised daemon)"
    pm2_supervision_check >/dev/null || true   # print the reason on stderr
  fi
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
  # Unquoted heredoc (for ${1}): NEVER put backticks or $(...) in the text —
  # they EXECUTE. Until 2026-11-09 a `pm2 restart all` here ran on every
  # automatic rollback, restarting every app on the shared VPS.
  local pfx
  pfx="$(naro_pm2_hint)"
  cat >&2 <<EOF
------------------------------------------------------------------------
The DATABASE was NOT rolled back. Migrations are forward-only and must be
backward compatible (expand/contract — docs/OPS/MIGRATIONS.md), so the
previous code should run against the migrated schema.
Only if it does not, restore the pre-deploy dump:
  bash scripts/ops/pm2-guard.sh   # must PASS before any pm2 command
  ${pfx}pm2 stop naro-api naro-admin naro-storefront
  sudo -u postgres psql -c "DROP DATABASE naro_fashion;"
  sudo -u postgres psql -c "CREATE DATABASE naro_fashion OWNER naro_admin;"
  PGPASSFILE=/root/.pgpass pg_restore --clean --if-exists --no-owner --no-acl \\
    -h localhost -U naro_admin -d naro_fashion ${1:-<pre-deploy dump in /var/backups/naro/postgres/>}
  # re-apply table ownership (docs/OPS/BACKUPS.md "Restoring"), then
  # (never 'pm2 restart all' — the VPS also runs other apps)
  ${pfx}pm2 restart naro-api naro-admin naro-storefront
------------------------------------------------------------------------
EOF
}
