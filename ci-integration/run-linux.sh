#!/usr/bin/env bash
# Linux CI runner for the R3 real-database suites (round 25D A). Runs on a
# throwaway Postgres service (CI) — never production. Each group gets a FRESH
# isolated schema, its own API process and seed, in the order the suites
# expect. The rollback group also runs the PREVIOUS build (no R3 code)
# against the database R3 migrated.
#   WT=<repo checkout> OLD_WT=<checkout of the previous build> SUITES=<dir> bash run-linux.sh
set -uo pipefail
: "${WT:?}" "${SUITES:?}" "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PSQL:=psql}"
export PGHOST PGPORT PSQL
case "$PGHOST" in localhost|127.0.0.1) ;; *) echo "refusing: local/CI database only" >&2; exit 2 ;; esac
OWNER_URL() { echo "postgresql://naro_admin:Admin123@${PGHOST}:${PGPORT}/naro_fashion?schema=$1"; }
LOGS="${LOGS:-/tmp/naro-it-logs}"; mkdir -p "$LOGS"
RESULTS=()
API_PID=""

reset_schema() {
  PGPASSWORD=Admin123 "$PSQL" -U naro_admin -d naro_fashion -w -X -q -v ON_ERROR_STOP=1 \
    -c "SET client_min_messages = warning" -c "DROP SCHEMA IF EXISTS $1 CASCADE" -c "CREATE SCHEMA $1"
  (cd "$WT/packages/database" && DATABASE_URL="$(OWNER_URL "$1")" pnpm exec prisma migrate deploy >/dev/null)
}
start_api() { # <checkout> <schema> <port> <label>
  (cd "$1/apps/api" && GIT_SHA="$4" DATABASE_URL="$(OWNER_URL "$2")" PORT="$3" NODE_ENV=development \
    TENANT_SCOPE_ENFORCEMENT=warn STOREFRONT_URL=http://localhost:3101 ADMIN_URL=http://localhost:3132 \
    SMTP_HOST= SMTP_USER= SMTP_PASS= JWT_SECRET=ci-only-jwt-secret-0123456789abcdef0123456789 \
    JWT_REFRESH_SECRET=ci-only-refresh-secret-0123456789abcdef01234567 \
    node dist/main.js > "$LOGS/api-$4-$2.log" 2>&1 & echo $! > "$LOGS/api.pid")
  API_PID="$(cat "$LOGS/api.pid")"
  curl -s --retry 120 --retry-connrefused --retry-delay 1 -o /dev/null "http://localhost:$3/api/v1/health" \
    || { echo "API $4 did not start"; tail -40 "$LOGS/api-$4-$2.log"; return 1; }
  echo "API $4 on :$3 ($2): $(curl -s "http://localhost:$3/api/v1/health")"
}
stop_api() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; sleep 1; API_PID=""; }
suite() { # <label> <cmd...>
  local label="$1"; shift
  echo "::group::$label"
  "$@" 2>&1 | tee "$LOGS/$label.txt"
  local rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  RESULTS+=("$label: $(grep -E 'passed' "$LOGS/$label.txt" | tail -1) (exit $rc)")
  return 0
}

cd "$SUITES"
# 1. POS rental regression (fresh)
reset_schema it_pos && start_api "$WT" it_pos 4130 head \
  && DATABASE_URL="$(OWNER_URL it_pos)" node pos-rental-seed.js "$WT" /tmp/ids-pos.json \
  && suite pos-rental env IT_R3=1 IT_UNIT_TRACKING=1 IT_REFUND_CONTROLS=1 ${IT_CANCELLATION:+IT_CANCELLATION=1} node pos-rental.it.mjs /tmp/ids-pos.json
stop_api
# 2. Late fees (fresh)
reset_schema it_pos && start_api "$WT" it_pos 4130 head \
  && DATABASE_URL="$(OWNER_URL it_pos)" node pos-rental-seed.js "$WT" /tmp/ids-lf.json \
  && suite latefee node latefee.it.mjs /tmp/ids-lf.json
stop_api
# 3. Database gate security (fresh)
reset_schema it_pos && start_api "$WT" it_pos 4130 head \
  && DATABASE_URL="$(OWNER_URL it_pos)" node pos-rental-seed.js "$WT" /tmp/ids-gate.json \
  && suite r3-gate-security node r3-gate-security.it.mjs /tmp/ids-gate.json
stop_api
# 4. R3 acceptance, then the rollback rehearsal on the bookings it leaves (fresh)
reset_schema it_pos && start_api "$WT" it_pos 4130 head \
  && DATABASE_URL="$(OWNER_URL it_pos)" node pos-rental-seed.js "$WT" /tmp/ids-r3.json \
  && suite r3-checklist node r3-checklist.it.mjs /tmp/ids-r3.json \
  && suite r3-rollback-prepare node r3-rollback.it.mjs /tmp/ids-r3.json prepare
stop_api
if [ -n "${OLD_WT:-}" ]; then
  start_api "$OLD_WT" it_pos 4130 previous && suite r3-rollback-old node r3-rollback.it.mjs /tmp/ids-r3.json old
  stop_api
  start_api "$WT" it_pos 4130 head && suite r3-rollback-forward node r3-rollback.it.mjs /tmp/ids-r3.json forward
  stop_api
fi
# 5. Unified refunds (own seed, schema it_ref)
reset_schema it_ref && start_api "$WT" it_ref 4150 head \
  && DATABASE_URL="$(OWNER_URL it_ref)" node refunds-seed.js "$WT" /tmp/ids-ref.json \
  && suite refunds env IT_R3=1 ${IT_RETURN_INSPECTION:+IT_RETURN_INSPECTION=1} IT_API=http://localhost:4150/api/v1 node refunds.it.mjs /tmp/ids-ref.json
stop_api

echo
echo "================ summary"
fail=0
for r in "${RESULTS[@]}"; do
  echo "$r"
  case "$r" in *"(exit 0)") ;; *) fail=1 ;; esac
done
expected="${EXPECTED_GROUPS:-8}"
[ "${#RESULTS[@]}" -ge "$expected" ] || { echo "only ${#RESULTS[@]} of ${expected} suites ran"; fail=1; }
exit $fail
