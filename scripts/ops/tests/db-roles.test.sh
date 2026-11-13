#!/usr/bin/env bash
# Self-test for scripts/ops/db-roles-lib.sh (round 25E B): the migration
# (owner) credential never reaches the runtime. Fakes only: a temp app dir,
# a fake `pnpm` / `pm2` that record the environment they were started with.
#   bash scripts/ops/tests/db-roles.test.sh
set -u
HERE="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fails=0; n=0
ok() { n=$((n + 1)); echo "  ok   - $1"; }
bad() { n=$((n + 1)); fails=$((fails + 1)); echo "  FAIL - $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

OWNER_URL='postgresql://naro_admin:OwnerSecret-xyz@localhost:5432/naro_fashion?schema=public'
APP_URL='postgresql://naro_app:AppSecret-abc@localhost:5432/naro_fashion?schema=public'
mkdir -p "$T/bin" "$T/app/apps/api" "$T/app/packages/database" "$T/out"
# Fake pnpm / pm2: record the environment they see (no network, no DB).
cat > "$T/bin/pnpm" <<EOF
#!/usr/bin/env bash
env > "$T/out/pnpm.env"
EOF
cat > "$T/bin/pm2" <<EOF
#!/usr/bin/env bash
env > "$T/out/pm2.env"
EOF
chmod +x "$T/bin/pnpm" "$T/bin/pm2"
PATH="$T/bin:$PATH"
app_env() { for f in "$T/app/.env" "$T/app/apps/api/.env" "$T/app/packages/database/.env"; do printf 'DATABASE_URL="%s"\n' "$1" > "$f"; done; }
owner_env() { printf 'MIGRATION_DATABASE_URL="%s"\nNARO_APP_DB_ROLE=naro_app\n' "$OWNER_URL" > "$T/owner.env"; chmod "${1:-600}" "$T/owner.env"; }
# Run the library in a child shell like deploy.sh does; prints "DIED: ..." on die().
run() {
  ( set -u
    log() { :; }
    die() { echo "DIED: $*"; exit 1; }
    export PM2_GUARD_TEST=1 DB_OWNER_ENV_OWNER
    DB_OWNER_ENV_OWNER="$(id -un)"
    # shellcheck source=scripts/ops/db-roles-lib.sh
    . "$HERE/scripts/ops/db-roles-lib.sh"
    eval "$1" )
}
OWNER_FILE="$T/owner.env"

echo "db-roles-lib: the migration credential stays out of the runtime"
app_env "$APP_URL"; rm -f "$OWNER_FILE"
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; echo MIGRATE=[\$MIGRATE_URL]")"
check "no owner file -> role separation off, nothing loaded" '[ "$out" = "MIGRATE=[]" ]'

owner_env 600
rm -f "$T/out/"*
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; DATABASE_URL='$APP_URL' prisma_db migrate deploy; bash -c 'echo CHILD=[\${MIGRATE_URL:-}][\${MIGRATION_DATABASE_URL:-}]'; DATABASE_URL='$APP_URL' pm2 reload naro-api --update-env; declare -p MIGRATE_URL")"
check "owner file (600) loads; the owner role is named" 'grep -q "^declare -- MIGRATE_URL=" <<<"$out"'
check "MIGRATE_URL is NOT exported (declare -- , not -x)" '! grep -q "^declare -x MIGRATE_URL" <<<"$out"'
check "prisma (migrations) runs with the OWNER url" 'grep -q "^DATABASE_URL=postgresql://naro_admin:" "$T/out/pnpm.env"'
check "a child process of the deploy shell does not see the owner url" 'grep -q "CHILD=\[\]\[\]" <<<"$out"'
check "pm2 --update-env inherits the RUNTIME url only" 'grep -q "^DATABASE_URL=postgresql://naro_app:" "$T/out/pm2.env" && ! grep -q "OwnerSecret-xyz" "$T/out/pm2.env"'
check "the owner password never appears in any recorded environment except prisma's" '! grep -q "OwnerSecret-xyz" "$T/out/pm2.env" && ! grep -q "OwnerSecret-xyz" <<<"$(grep -v MIGRATE_URL <<<"$out")"'

owner_env 644
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; echo LOADED")"
check "owner file readable by others (644) -> deploy refuses" 'grep -q "^DIED: .*mode 600" <<<"$out"'

owner_env 600; app_env "$OWNER_URL"
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; echo LOADED")"
check "an app .env still using the OWNER role -> deploy refuses" 'grep -q "^DIED: role separation: .* still connects as the owner role naro_admin" <<<"$out"'

app_env "$APP_URL"; printf 'MIGRATION_DATABASE_URL="%s"\n' "$OWNER_URL" >> "$T/app/apps/api/.env"
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; echo LOADED")"
check "the owner credential copied into an app .env -> deploy refuses" 'grep -q "^DIED: role separation: .*contains MIGRATION_DATABASE_URL" <<<"$out"'

app_env "$APP_URL"; printf 'MIGRATION_DATABASE_URL="postgresql://naro_app:x@localhost:5432/naro_fashion"\n' > "$OWNER_FILE"; chmod 600 "$OWNER_FILE"
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; echo LOADED")"
check "owner and runtime roles identical -> deploy refuses" 'grep -q "^DIED: .*must be different" <<<"$out"'

rm -f "$OWNER_FILE" "$T/out/"*
out="$(run "db_roles_load '$OWNER_FILE' '$T/app'; DATABASE_URL='$APP_URL' prisma_db migrate deploy; db_roles_apply_and_verify '$T/app'; echo DONE")"
check "separation off -> prisma keeps the app url, no grants/verify step runs" 'grep -q "^DATABASE_URL=postgresql://naro_app:" "$T/out/pnpm.env" && grep -q "^DONE" <<<"$out"'

echo
echo "$((n - fails))/$n passed"
[ "$fails" -eq 0 ]
