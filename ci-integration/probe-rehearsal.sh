#!/usr/bin/env bash
# Rehearsal of the W1 / W2 / W3 live probes (cms-live-probe.mjs, sec-live-probe.mjs)
# on ONE throwaway schema, walking the real release order and back:
#   3d95365 → W1 → W2 → W3 → (rollback) W2 → (rollback) W1
# CI / local Postgres only — never production. Each API build runs with GIT_SHA
# = its full commit, so the probes' health check is the real one.
#   BASE_WT W1_WT W2_WT W3_WT (checkouts with apps/api/dist built)
#   BASE_SHA W1_SHA W2_SHA W3_SHA, PROBES=<dir with the two probes>, SUITES=<this dir>
#   [LOGS] [PSQL] bash probe-rehearsal.sh
set -uo pipefail
: "${BASE_WT:?}" "${W1_WT:?}" "${W2_WT:?}" "${W3_WT:?}" "${BASE_SHA:?}" "${W1_SHA:?}" "${W2_SHA:?}" "${W3_SHA:?}" "${PROBES:?}" "${SUITES:?}"
: "${PGHOST:=localhost}" "${PGPORT:=5432}" "${PSQL:=psql}" "${LOGS:=/tmp/naro-it-logs}"
case "$PGHOST" in localhost|127.0.0.1) ;; *) echo "refusing: local/CI database only" >&2; exit 2 ;; esac
mkdir -p "$LOGS"
SCHEMA=it_sec; PORT=4160; T="$LOGS/probe-rehearsal"; mkdir -p "$T"
URL="postgresql://naro_admin:Admin123@${PGHOST}:${PGPORT}/naro_fashion?schema=${SCHEMA}"
OWN() { PGPASSWORD=Admin123 "$PSQL" -h "$PGHOST" -p "$PGPORT" -U naro_admin -d naro_fashion -w -X -q -v ON_ERROR_STOP=1 "$@"; }
API_PID=""; RESULTS=(); fail=0

start_api() { # <checkout> <sha>
  ( cd "$1/apps/api" && exec env GIT_SHA="$2" DATABASE_URL="$URL" PORT="$PORT" NODE_ENV=development \
    TENANT_SCOPE_ENFORCEMENT=warn STOREFRONT_URL=http://localhost:3101 ADMIN_URL=http://localhost:3132 \
    SMTP_HOST= SMTP_USER= SMTP_PASS= JWT_SECRET=ci-only-jwt-secret-0123456789abcdef0123456789 \
    JWT_REFRESH_SECRET=ci-only-refresh-secret-0123456789abcdef01234567 \
    node dist/main.js ) > "$T/api-${2:0:7}-$(date +%s).log" 2>&1 &
  API_PID=$!
  curl -s --retry 120 --retry-connrefused --retry-delay 1 -o /dev/null "http://localhost:$PORT/api/v1/health" || { echo "API ${2:0:7} did not start"; return 1; }
  curl -s "http://localhost:$PORT/api/v1/health" | grep -q "\"commit\":\"$2\"" || { echo "wrong API on :$PORT"; return 1; }
  echo "-- API ${2:0:7} up"
}
stop_api() {
  [ -n "$API_PID" ] || return 0
  kill "$API_PID" 2>/dev/null
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/api/v1/health" || break; sleep 1; done
  API_PID=""
}
# <label> <expected exit: 0 pass | 1 must fail (negative control)> <cmd...>
step() {
  local label="$1" want="$2"; shift 2
  echo "::group::$label"
  "$@" 2>&1 | tee "$T/$label.txt"; local rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  if { [ "$want" = 0 ] && [ "$rc" = 0 ]; } || { [ "$want" = 1 ] && [ "$rc" != 0 ]; }; then RESULTS+=("$label: as expected (exit $rc)")
  else RESULTS+=("$label: UNEXPECTED (exit $rc, wanted $([ "$want" = 0 ] && echo 0 || echo non-zero))"); fail=1; fi
}

OWN -c "SET client_min_messages = warning" -c "DROP SCHEMA IF EXISTS $SCHEMA CASCADE" -c "CREATE SCHEMA $SCHEMA" || exit 1
(cd "$W3_WT/packages/database" && DATABASE_URL="$URL" pnpm exec prisma migrate deploy > /dev/null) || { echo "migrate failed"; exit 1; }

start_api "$BASE_WT" "$BASE_SHA" || exit 1
(cd "$SUITES" && DATABASE_URL="$URL" node sec-seed.js "$BASE_WT" "$T/ids.json") | tail -1 || exit 1
TA=$(node -e "console.log(require('$T/ids.json').a.tenantId)")
FAQ=$(node -e "console.log(require('$T/ids.json').a.pages.published)")
EMAIL=$(node -e "console.log(require('$T/ids.json').a.superEmail)")
# secret-valued + harmless settings, inventory module on (as in production)
OWN -c "SET search_path TO $SCHEMA" \
  -c "INSERT INTO \"SiteSetting\"(id,\"tenantId\",key,value) VALUES ('it_s1','$TA','instagram_access_token','IT-SECRET-TOKEN'),('it_s2','$TA','facebook_app_secret','IT-SECRET-APP'),('it_s3','$TA','auth_access_token_expires','15m'),('it_s4','$TA','hero_title','Hello')" \
  -c "INSERT INTO \"TenantModule\"(id,\"tenantId\",\"moduleCode\",\"isEnabled\") VALUES ('it_m1','$TA','inventory',true)" || exit 1
ADMIN_TOKEN=$(curl -s -X POST "http://localhost:$PORT/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"ItTest12345\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).accessToken||''))")
[ -n "$ADMIN_TOKEN" ] || { echo "login failed"; exit 1; }
export ADMIN_TOKEN PROBE_API="http://localhost:$PORT/api/v1" PROBE_TENANT="$TA" PROBE_FAQ_ID="$FAQ" PROBE_SKIP_STORE=1
CMS="$PROBES/cms-live-probe.mjs"; SEC="$PROBES/sec-live-probe.mjs"

# --- W1 window: snapshot on production (3d95365), verify on W1
step w1-snapshot 0 node "$CMS" snapshot "$T/snap0.json"
stop_api; start_api "$W1_WT" "$W1_SHA" || exit 1
step w1-verify 0 node "$CMS" verify "$T/snap0.json" "$W1_SHA"
step w2-checks-fail-on-w1-control 1 node "$SEC" verify-w2 "$T/snap0.json" "$W1_SHA"
# --- W2 window: snapshot on W1 (public list fallback), verify on W2
step w2-snapshot 0 node "$SEC" snapshot "$T/snap1.json"
grep -q '"source": "public"' "$T/snap1.json" && RESULTS+=("w2-snapshot source=public on W1: as expected") || { RESULTS+=("w2-snapshot source: UNEXPECTED"); fail=1; }
stop_api; start_api "$W2_WT" "$W2_SHA" || exit 1
step w2-verify 0 node "$SEC" verify-w2 "$T/snap1.json" "$W2_SHA"
# --- W3 window: snapshot on W2 (admin list), verify on W3
step w3-snapshot 0 node "$SEC" snapshot "$T/snap2.json"
grep -q '"source": "admin"' "$T/snap2.json" && RESULTS+=("w3-snapshot source=admin on W2: as expected") || { RESULTS+=("w3-snapshot source: UNEXPECTED"); fail=1; }
step w3-old-code-control 1 node "$SEC" verify-w3 "$T/snap2.json" "$W2_SHA"
grep -q 'adjust type SALE → 404' "$T/w3-old-code-control.txt" && RESULTS+=("w3 control: W2 answers 404 to the SALE probe (probe discriminates)") || { RESULTS+=("w3 control: SALE probe did not discriminate"); fail=1; }
stop_api; start_api "$W3_WT" "$W3_SHA" || exit 1
step w3-verify 0 node "$SEC" verify-w3 "$T/snap2.json" "$W3_SHA"
# --- rollbacks: W3 → W2, then W2 → W1 (one level each, as rollback.sh)
stop_api; start_api "$W2_WT" "$W2_SHA" || exit 1
step rollback-to-w2-verify 0 node "$SEC" verify-w2 "$T/snap2.json" "$W2_SHA"
stop_api; start_api "$W1_WT" "$W1_SHA" || exit 1
step rollback-to-w1-verify 0 node "$CMS" verify "$T/snap0.json" "$W1_SHA"
stop_api

n=$(OWN -At -c "SET search_path TO $SCHEMA" -c "SELECT count(*) FROM \"InventoryTransaction\"" | tail -1)
[ "$n" = 0 ] && RESULTS+=("no InventoryTransaction row written by any probe: ok") || { RESULTS+=("InventoryTransaction rows: $n UNEXPECTED"); fail=1; }
p=$(OWN -At -c "SET search_path TO $SCHEMA" -c "SELECT string_agg(status, ',' ORDER BY \"transactionRef\") FROM \"Payment\"" | tail -1)
[ "$p" = "PENDING,PENDING" ] && RESULTS+=("payments untouched (PENDING,PENDING): ok") || { RESULTS+=("payments: $p UNEXPECTED"); fail=1; }
OWN -c "DROP SCHEMA IF EXISTS $SCHEMA CASCADE" > /dev/null

echo; echo "================ probe rehearsal summary"
for r in "${RESULTS[@]}"; do echo "$r"; done
[ "$fail" = 0 ] && echo "probe rehearsal: ALL AS EXPECTED" || echo "probe rehearsal: FAILED"
exit $fail
