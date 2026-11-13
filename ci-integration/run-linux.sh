#!/usr/bin/env bash
# Linux CI runner for the real-database suites (rounds 25D/25E). Throwaway
# Postgres service (CI) only — never production. Each group gets a FRESH
# isolated schema, its own API process and seed.
#   WT=<checkout> SUITES=<dir> SUITE_GROUPS="pos-rental latefee ..." [OLD_WT=<previous build>]
#   [ROLE_SEPARATION=1 DB_ROLES_DIR=<dir with 01/02/03 sql>] bash run-linux.sh
# ROLE_SEPARATION=1: the API connects as naro_app (created by 01-roles.sql as
# the CI superuser; 02-grants.sql after every migration, 03-verify must pass).
set -uo pipefail
: "${WT:?}" "${SUITES:?}" "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PSQL:=psql}"
: "${SUITE_GROUPS:=pos-rental latefee r3-gate r3-checklist-rollback refunds}"
export PGHOST PGPORT PSQL
case "$PGHOST" in localhost|127.0.0.1) ;; *) echo "refusing: local/CI database only" >&2; exit 2 ;; esac
APP_PW="ci-app-password-0123456789abcdef"
OWNER_URL() { echo "postgresql://naro_admin:Admin123@${PGHOST}:${PGPORT}/naro_fashion?schema=$1"; }
RUNTIME_URL() {
  if [ "${ROLE_SEPARATION:-}" = "1" ]; then echo "postgresql://naro_app:${APP_PW}@${PGHOST}:${PGPORT}/naro_fashion?schema=$1"; else OWNER_URL "$1"; fi
}
LOGS="${LOGS:-/tmp/naro-it-logs}"; mkdir -p "$LOGS"
RESULTS=()
API_PID=""; API_PORT=""
OWN() { PGPASSWORD=Admin123 "$PSQL" -U naro_admin -d naro_fashion -w -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "${ROLE_SEPARATION:-}" = "1" ]; then
  : "${DB_ROLES_DIR:?}"
  NARO_APP_DB_PASSWORD="$APP_PW" PGPASSWORD="${PGSUPER_PASSWORD:-ci}" "$PSQL" -U "${PGSUPER:-postgres}" -d naro_fashion -w -X -q -v ON_ERROR_STOP=1 \
    -v db=naro_fashion -v owner=naro_admin -v app=naro_app -v schema=public -f "$DB_ROLES_DIR/01-roles.sql" || { echo "01-roles failed"; exit 1; }
fi

reset_schema() {
  OWN -c "SET client_min_messages = warning" -c "DROP SCHEMA IF EXISTS $1 CASCADE" -c "CREATE SCHEMA $1" || return 1
  (cd "$WT/packages/database" && DATABASE_URL="$(OWNER_URL "$1")" pnpm exec prisma migrate deploy >/dev/null) || return 1
  if [ "${ROLE_SEPARATION:-}" = "1" ]; then
    OWN -v app=naro_app -v schema="$1" -f "$DB_ROLES_DIR/02-grants.sql" >/dev/null || return 1
    OWN -v app=naro_app -v owner=naro_admin -v schema="$1" -f "$DB_ROLES_DIR/03-verify.sql" | tail -1
    [ "${PIPESTATUS[0]}" = "0" ] || return 1
  fi
}
start_api() { # <checkout> <schema> <port> <label>
  # exec: the background job IS the node process, so $! can be stopped.
  ( cd "$1/apps/api" && exec env GIT_SHA="$4" DATABASE_URL="$(RUNTIME_URL "$2")" PORT="$3" NODE_ENV=development \
    TENANT_SCOPE_ENFORCEMENT=warn STOREFRONT_URL=http://localhost:3101 ADMIN_URL=http://localhost:3132 \
    SMTP_HOST= SMTP_USER= SMTP_PASS= JWT_SECRET=ci-only-jwt-secret-0123456789abcdef0123456789 \
    JWT_REFRESH_SECRET=ci-only-refresh-secret-0123456789abcdef01234567 \
    node dist/main.js ) > "$LOGS/api-$4-$2.log" 2>&1 &
  API_PID=$!
  API_PORT="$3"
  curl -s --retry 120 --retry-connrefused --retry-delay 1 -o /dev/null "http://localhost:$3/api/v1/health" \
    || { echo "API $4 did not start"; tail -40 "$LOGS/api-$4-$2.log"; return 1; }
  local h; h="$(curl -s "http://localhost:$3/api/v1/health")"
  echo "API $4 on :$3 ($2, as $(RUNTIME_URL "$2" | sed -E 's#^postgresql://([^:]+):.*#\1#')): $h"
  case "$h" in *"\"commit\":\"$4\""*) ;; *) echo "wrong API answering on :$3"; return 1 ;; esac
}
stop_api() {
  [ -n "$API_PID" ] || return 0
  kill "$API_PID" 2>/dev/null
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:${API_PORT}/api/v1/health" || break; sleep 1; done
  API_PID=""
}
suite() { # <label> <cmd...>
  local label="$1"; shift
  echo "::group::$label"
  "$@" 2>&1 | tee "$LOGS/$label.txt"
  local rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  RESULTS+=("$label: $(grep -E 'passed' "$LOGS/$label.txt" | tail -1) (exit $rc)")
  return 0
}
fresh() { # <schema> <port> <seed> <ids>
  reset_schema "$1" && start_api "$WT" "$1" "$2" head \
    && DATABASE_URL="$(OWNER_URL "$1")" node "$3" "$WT" "$4" | tail -1
}
missing() { RESULTS+=("$1: SET-UP FAILED (exit 1)"); }

cd "$SUITES"
for g in $SUITE_GROUPS; do
  case "$g" in
    pos-rental) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-pos.json \
        && suite pos-rental env ${POS_FLAGS:-IT_R3=1 IT_UNIT_TRACKING=1 IT_REFUND_CONTROLS=1} node pos-rental.it.mjs /tmp/ids-pos.json || missing pos-rental ;;
    latefee) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-lf.json && suite latefee node latefee.it.mjs /tmp/ids-lf.json || missing latefee ;;
    r3-gate) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-gate.json && suite r3-gate-security node r3-gate-security.it.mjs /tmp/ids-gate.json || missing r3-gate-security ;;
    db-roles) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-roles.json \
        && suite db-roles env IT_APP_PASSWORD="$APP_PW" DB_ROLES_DIR="$DB_ROLES_DIR" node db-roles.it.mjs /tmp/ids-roles.json || missing db-roles ;;
    cancellation) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-can.json \
        && suite cancellation env IT_JOB_DATABASE_URL="$(RUNTIME_URL it_pos)" node cancellation.it.mjs "$WT" /tmp/ids-can.json \
        && suite cancellation-e node cancellation-e.it.mjs "$WT" /tmp/ids-can.json || missing cancellation ;;
    # Round 25F E (PR #52): stock write-off / decrease and payment-reversal approvals.
    # On approval builds also export IT_APPROVALS=1 so inventory-sec expects the approval path.
    approvals) fresh it_e 4195 approvals-seed.js /tmp/ids-appr.json \
        && suite approvals env IT_API=http://localhost:4195/api/v1 IT_SCHEMA=it_e node approvals.it.mjs /tmp/ids-appr.json || missing approvals ;;
    inventory-sec) fresh it_inv 4135 inventory-sec-seed.js /tmp/ids-inv.json && suite inventory-sec env IT_API=http://localhost:4135/api/v1 node inventory-sec.it.mjs /tmp/ids-inv.json || missing inventory-sec ;;
    escalation) fresh it_esc 4136 escalation-seed.js /tmp/ids-esc.json && suite escalation env IT_API=http://localhost:4136/api/v1 IT_SCHEMA=it_esc node escalation.it.mjs /tmp/ids-esc.json || missing escalation ;;
    sod) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-sod.json && suite sod env ${SOD_FLAGS:-} node sod.it.mjs /tmp/ids-sod.json || missing sod ;;
    r1-accounting) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-r1.json && suite r1-refund-accounting env ${R1_FLAGS:-} node r1-refund-accounting.it.mjs /tmp/ids-r1.json || missing r1-refund-accounting ;;
    # Round 25F: integrated R1 refund accounting (#37 under #36) under concurrency.
    r1-integration) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-r1i.json && suite r1-integration node r1-integration.it.mjs "$WT" /tmp/ids-r1i.json || missing r1-integration ;;
    shift-reconciliation) fresh it_r4 4170 shift-reconciliation-seed.js /tmp/ids-r4.json \
        && suite shift-reconciliation env IT_API=http://localhost:4170/api/v1 IT_SCHEMA=it_r4 node shift-reconciliation.it.mjs /tmp/ids-r4.json || missing shift-reconciliation ;;
    r3-checklist-rollback)
      if fresh it_pos 4130 pos-rental-seed.js /tmp/ids-r3.json; then
        suite r3-checklist node r3-checklist.it.mjs /tmp/ids-r3.json
        suite r3-rollback-prepare node r3-rollback.it.mjs /tmp/ids-r3.json prepare
        stop_api
        if [ -n "${OLD_WT:-}" ]; then
          start_api "$OLD_WT" it_pos 4130 previous && suite r3-rollback-old node r3-rollback.it.mjs /tmp/ids-r3.json old || missing r3-rollback-old
          stop_api
          start_api "$WT" it_pos 4130 head && suite r3-rollback-forward node r3-rollback.it.mjs /tmp/ids-r3.json forward || missing r3-rollback-forward
        fi
      else missing r3-checklist; fi ;;
    refunds) reset_schema it_ref && start_api "$WT" it_ref 4150 head \
        && DATABASE_URL="$(OWNER_URL it_ref)" node refunds-seed.js "$WT" /tmp/ids-ref.json | tail -1 \
        && suite refunds env ${REFUND_FLAGS:-IT_R3=1} IT_API=http://localhost:4150/api/v1 node refunds.it.mjs /tmp/ids-ref.json || missing refunds ;;
    # Round 25F D (two-person checklist template approval). On template-approval
    # builds also export IT_TEMPLATE_APPROVAL=1 so the other R3 suites approve
    # their templates in set-up (by the seeded tplApprover, never the author).
    template-approval) fresh it_pos 4130 pos-rental-seed.js /tmp/ids-tpl.json \
        && suite template-approval env IT_API=http://localhost:4130/api/v1 IT_SCHEMA=it_pos node template-approval.it.mjs /tmp/ids-tpl.json || missing template-approval ;;
    # refunds:payout (payout-only permission) + the three-person refund workflow.
    # Port 4177: fetch() refuses 4190 (a "bad port").
    refund-payout) reset_schema it_payout && start_api "$WT" it_payout 4177 head \
        && DATABASE_URL="$(OWNER_URL it_payout)" node refund-payout-seed.js "$WT" /tmp/ids-payout.json | tail -1 \
        && suite refund-payout env IT_API=http://localhost:4177/api/v1 IT_SCHEMA=it_payout node refund-payout.it.mjs /tmp/ids-payout.json || missing refund-payout ;;
    *) echo "unknown group $g"; missing "$g" ;;
  esac
  stop_api
done

echo
echo "================ summary"
fail=0
for r in "${RESULTS[@]}"; do
  echo "$r"
  case "$r" in *"(exit 0)") ;; *) fail=1 ;; esac
done
[ "${#RESULTS[@]}" -gt 0 ] || fail=1
exit $fail
