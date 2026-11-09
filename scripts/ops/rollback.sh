#!/usr/bin/env bash
# Manual one-shot rollback to the build that was live before the last deploy.
#
#   ssh root@80.240.30.107 "cd /var/www/naro-fashion && bash scripts/ops/rollback.sh"
#
# Same logic deploy.sh uses for its automatic rollback:
#   1. refuse unless every *-prev build exists and .deploy/previous_sha is set
#   2. swap apps/<app>/.next-prev -> .next, apps/api/dist-prev -> dist
#      (the build being replaced is kept as .next-failed / dist-failed)
#   3. git reset --hard <previous_sha> (+ pnpm install if the lockfile
#      differs, + prisma generate) so source matches the running build
#   4. pm2 reload ecosystem.config.js --update-env, then health checks
#
# Refuses up front (and again right before pm2) unless the PM2 supervision
# guard passes — scripts/ops/pm2-guard.sh.
#
# It is one-shot: the *-prev dirs are consumed, so a second run refuses until
# the next successful deploy. The DATABASE is never touched (migrations are
# forward-only and backward compatible — docs/OPS/MIGRATIONS.md).
#
# NOTE: CI redeploys on the next push to prod. If the bad commit is still the
# tip of prod, revert it (git revert) before pushing anything else.
#
# Options:  --yes   skip the interactive confirmation

set -euo pipefail
# The PM2 guard's test-only overrides must never apply to a real rollback.
unset PM2_GUARD_TEST

APP_DIR="${APP_DIR:-/var/www/naro-fashion}"
cd "$APP_DIR"

# Source the helpers BEFORE resetting git (the old commit may not have them).
# shellcheck source=scripts/ops/deploy-lib.sh
. "$APP_DIR/scripts/ops/deploy-lib.sh"

die() { echo "[$(ts)] ❌ ROLLBACK REFUSED/FAILED: $*" >&2; exit 1; }

ASSUME_YES=0
if [ "${1:-}" = "--yes" ]; then ASSUME_YES=1; fi

PREV_SHA="$(cat "${DEPLOY_STATE_DIR}/previous_sha" 2>/dev/null | tr -d '[:space:]' || true)"
CUR_SHA="$(cat "${DEPLOY_STATE_DIR}/current_sha" 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$CUR_SHA" ] || CUR_SHA="$(git rev-parse HEAD)"

# --- Safety checks ---------------------------------------------------------
[ -n "$PREV_SHA" ] || die "${DEPLOY_STATE_DIR}/previous_sha is missing — nothing to roll back to (already rolled back, or no deploy has kept a previous build yet)."
is_commit "$PREV_SHA" || die "previous_sha '${PREV_SHA}' is not a known commit in this repo."
if ! missing="$(missing_prev_artifacts)"; then
  die "previous build artifacts are missing: ${missing//$'\n'/ }. Refusing a partial rollback (it would mix builds from different commits)."
fi
# PM2 supervision must be intact BEFORE anything is swapped (read-only check,
# never invokes pm2; reload_pm2 re-checks right before the first pm2 command).
pm2_supervision_check \
  || die "PM2 supervision check failed — nothing was changed. An administrator must recover ${PM2_GUARD_UNIT} via systemd first."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  warn "tracked files are modified on the VPS — they will be DISCARDED by git reset --hard:"
  git status --short --untracked-files=no >&2
fi

log "Rollback plan: ${CUR_SHA:0:7} -> ${PREV_SHA:0:7} ($(git log -1 --pretty=%s "$PREV_SHA"))"
if ! has_pm2_guard "$PREV_SHA"; then
  log "🛡  ${PREV_SHA:0:7} predates the PM2 guard: application code will be ${PREV_SHA:0:7}, the guarded deploy tooling stays (from ${CUR_SHA:0:7})."
fi
for app in "${NEXT_APPS[@]}"; do
  log "  ${app}: .next-prev BUILD_ID $(cat "apps/${app}/.next-prev/BUILD_ID")"
done
if [ "$ASSUME_YES" -ne 1 ]; then
  if [ -t 0 ]; then
    read -r -p "Proceed? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "aborted by operator"
  else
    die "not a terminal — re-run with --yes to confirm"
  fi
fi

# --- Do it -----------------------------------------------------------------
trap 'echo "[$(ts)] ❌ ROLLBACK FAILED at line $LINENO — state may be half-swapped; inspect apps/*/.next* and apps/api/dist*" >&2' ERR

# Exit codes: 0 = rollback complete and healthy; 1 = refused, nothing
# changed; 3 = rollback INCOMPLETE (operator intervention required).
if ! swap_back_artifacts; then
  rollback_incomplete_notice "$PREV_SHA" "moving the previous builds back into place failed (builds may be MIXED); pm2 was not touched"
  exit 3
fi
problems=""
restore_source_to "$PREV_SHA" "$CUR_SHA" || problems="source tree / dependencies not fully restored (see warnings above)"
record_rollback_state "$PREV_SHA" "$CUR_SHA"
if ! reload_pm2 "$PREV_SHA"; then
  rollback_incomplete_notice "$PREV_SHA" "builds restored, but the PM2 reload was refused or failed${problems:+; also: $problems}"
  exit 3
fi

log "🩺 Running health checks..."
if ! run_health_checks; then
  pm2_diagnostics
  rollback_incomplete_notice "$PREV_SHA" "the restored build is NOT healthy${problems:+; also: $problems}"
  print_db_rollback_help ""
  exit 3
fi
if [ -n "$problems" ]; then
  rollback_incomplete_notice "$PREV_SHA" "the restored build answers health checks, but: $problems"
  exit 3
fi
log "✅ Rollback COMPLETE and healthy: ${PREV_SHA:0:7}. Database untouched."
log "Remember: the next push to prod redeploys — revert ${CUR_SHA:0:7} on prod first if it is the culprit."
