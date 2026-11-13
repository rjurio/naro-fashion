#!/usr/bin/env bash
# Database role separation helpers for deploy.sh (scripts/ops/db-roles/).
# Sourced, never executed. Expects the caller to define die() and log().
#
# /etc/naro-db-owner.env (root, 600) holds MIGRATION_DATABASE_URL (the OWNER
# role, e.g. naro_admin) and NARO_APP_DB_ROLE (the runtime role, default
# naro_app). The owner URL is kept in a NON-exported shell variable and
# handed to one command at a time (prisma_db, psql_owner), so it never
# reaches `pm2 reload --update-env` (which copies the deploy shell's
# environment into the apps) or any other child process. It is never printed.

MIGRATE_URL=""
APP_DB_ROLE=""
OWNER_DB_ROLE=""

db_url_role() { sed -E 's#^postgres(ql)?://([^:@/]+).*#\2#'; }
db_env_value() { sed -n "s/^$1=//p" "$2" | head -1 | sed -e 's/^"//' -e 's/"$//'; }

# db_roles_load <owner env file> <app dir>: sets MIGRATE_URL / APP_DB_ROLE /
# OWNER_DB_ROLE (not exported) when the file exists; refuses unsafe states.
db_roles_load() {
  local f="$1" app_dir="$2" expected_owner="root" envf runtime
  # Tests only (PM2_GUARD_TEST=1): the file may belong to the test user.
  if [ "${PM2_GUARD_TEST:-}" = "1" ] && [ -n "${DB_OWNER_ENV_OWNER:-}" ]; then expected_owner="$DB_OWNER_ENV_OWNER"; fi
  MIGRATE_URL=""; APP_DB_ROLE=""; OWNER_DB_ROLE=""
  if [ ! -f "$f" ]; then
    log "ℹ Role separation not configured (${f} absent): migrations use the app's DATABASE_URL"
    return 0
  fi
  [ "$(stat -c '%a %U' "$f")" = "600 ${expected_owner}" ] || die "${f} must be owned by ${expected_owner} with mode 600"
  MIGRATE_URL="$(db_env_value MIGRATION_DATABASE_URL "$f")"
  APP_DB_ROLE="$(db_env_value NARO_APP_DB_ROLE "$f")"
  APP_DB_ROLE="${APP_DB_ROLE:-naro_app}"
  [ -n "$MIGRATE_URL" ] || die "${f} has no MIGRATION_DATABASE_URL"
  OWNER_DB_ROLE="$(printf '%s' "$MIGRATE_URL" | db_url_role)"
  [ -n "$OWNER_DB_ROLE" ] && [ "$OWNER_DB_ROLE" != "$APP_DB_ROLE" ] || die "${f}: the owner and runtime roles must be different"
  # Fail closed if any runtime .env still connects as the owner role.
  for envf in "$app_dir/.env" "$app_dir/apps/api/.env" "$app_dir/packages/database/.env"; do
    [ -f "$envf" ] || continue
    runtime="$(db_env_value DATABASE_URL "$envf" | db_url_role)"
    if [ -n "$runtime" ] && [ "$runtime" = "$OWNER_DB_ROLE" ]; then
      die "role separation: ${envf} still connects as the owner role ${OWNER_DB_ROLE}; the app must use ${APP_DB_ROLE}"
    fi
    if grep -q '^MIGRATION_DATABASE_URL=' "$envf"; then
      die "role separation: ${envf} contains MIGRATION_DATABASE_URL; the owner credential must live only in ${f}"
    fi
  done
  log "🔐 Role separation ON: migrations as ${OWNER_DB_ROLE}, runtime as ${APP_DB_ROLE}"
}

# prisma with the owner URL when role separation is on (per command, never exported).
prisma_db() {
  if [ -n "$MIGRATE_URL" ]; then DATABASE_URL="$MIGRATE_URL" pnpm exec prisma "$@"; else pnpm exec prisma "$@"; fi
}

# Re-apply the runtime role's privileges and verify them (only when ON).
db_roles_apply_and_verify() {
  local app_dir="$1"
  [ -n "$MIGRATE_URL" ] || return 0
  psql "$MIGRATE_URL" -X -q -v ON_ERROR_STOP=1 -v app="$APP_DB_ROLE" -v schema=public \
    -f "$app_dir/scripts/ops/db-roles/02-grants.sql" >/dev/null \
    || die "role separation: 02-grants.sql failed; the runtime role's privileges were not applied"
  psql "$MIGRATE_URL" -X -q -v ON_ERROR_STOP=1 -v app="$APP_DB_ROLE" -v owner="$OWNER_DB_ROLE" -v schema=public \
    -f "$app_dir/scripts/ops/db-roles/03-verify.sql" \
    || die "role separation: 03-verify.sql failed (output above); refusing to deploy"
}
