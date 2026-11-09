#!/usr/bin/env bash
# Self-test for scripts/ops/pm2-guard.sh, its wiring in deploy-lib.sh, and the
# full deploy.sh / rollback.sh flows. Runs anywhere bash + git + node exist
# (CI: ubuntu-latest; also Git Bash on Windows).
#
#   bash scripts/ops/tests/pm2-guard.test.sh
#
# Everything runs against FAKES in a temp dir: a fake /proc, fake systemctl/ss,
# and decoys for pm2, pnpm, psql, sudo, curl, sleep and date. The script
# refuses to start unless every one of those names resolves to its decoy, so
# it can never start a real PM2 daemon, touch a real database or a real
# /var/www. The deploy/rollback flows run the REAL deploy.sh / rollback.sh
# copied into a throwaway git repo; the only rewrites are APP_DIR and the
# `unset PM2_GUARD_TEST` line (both asserted to exist first).
#
# Sections: 1) guard scenarios  2) deploy-lib wiring  3) deploy/rollback
# flows  4) static invariants.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD="$REPO/scripts/ops/pm2-guard.sh"
REAL_DATE="$(command -v date)"
T="$(mktemp -d)"
# Git Bash: a "C:/..." path would split PATH at the drive colon and let the
# REAL tools win over the decoys below — normalise to a POSIX path.
if command -v cygpath >/dev/null 2>&1; then T="$(cygpath -u "$T")"; fi
trap 'rm -rf "$T"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   - $*"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $*"; }
show() { sed 's/^/        /' "$1" | tail -"${2:-40}"; }

PROC="$T/proc"
PMH="$T/root/.pm2"
BIN="$T/bin"        # pm2 decoy, fake systemctl / ss
BINF="$T/binf"      # flow decoys: pnpm psql sudo curl sleep date
CG_UNIT="/system.slice/pm2-root.service"
CG_SSH="/user.slice/user-0.slice/session-7.scope"

# ---------------------------------------------------------------------------
# Fixture: a healthy supervised daemon (mirrors the real VPS, 2026-11-09)
# ---------------------------------------------------------------------------
mkproc() {
  # mkproc <pid> <ppid> <uid> <cgroup> <cmdline> [env-entry...]
  local pid="$1" ppid="$2" uid="$3" cg="$4" cmd="$5"
  shift 5
  mkdir -p "$PROC/$pid"
  printf 'Name:\tx\nPPid:\t%s\nUid:\t%s\t%s\t%s\t%s\n' "$ppid" "$uid" "$uid" "$uid" "$uid" > "$PROC/$pid/status"
  printf '0::%s\n' "$cg" > "$PROC/$pid/cgroup"
  printf '%s\0' "$cmd" > "$PROC/$pid/cmdline"
  : > "$PROC/$pid/environ"
  local e
  for e in "$@"; do printf '%s\0' "$e" >> "$PROC/$pid/environ"; done
}

SOCKFLAG="-S"
mksock() {
  rm -f "$1"
  local py
  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 \
       && "$py" -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$1" 2>/dev/null \
       && [ -S "$1" ]; then
      return 0
    fi
  done
  # No AF_UNIX available (e.g. Git Bash on Windows): plain file + -e check.
  : > "$1"
  SOCKFLAG="-e"
}

fresh() {
  rm -rf "$PROC" "$T/root" "$T/pm2_calls" "$T/sysctl_count" "$T/mutate_at" "$T/mutate.sh"
  mkdir -p "$PROC" "$PMH"
  mkproc 1 0 0 /init.scope /sbin/init
  mkproc 1000 1 0 "$CG_UNIT" "PM2 v6.0.14: God Daemon ($PMH)" "PM2_HOME=$PMH"
  # cluster-mode workers (app identified via pm2_env JSON), as on the VPS
  mkproc 1001 1000 0 "$CG_UNIT" "node /var/www/naro-fashion/apps/api/dist/main.js" 'pm2_env={"exec_mode":"cluster_mode","name":"naro-api","pm_id":1}'
  mkproc 1002 1000 0 "$CG_UNIT" "next-server (v15.5.27)" 'pm2_env={"name":"naro-storefront","exec_mode":"cluster_mode","pm_id":2}'
  mkproc 1003 1000 0 "$CG_UNIT" "next-server (v15.5.27)" 'pm2_env={"exec_mode":"cluster_mode","name":"naro-admin","pm_id":3}'
  # other apps sharing the daemon + a fork-mode app + a grandchild of the API
  mkproc 1004 1000 0 "$CG_UNIT" "node sportflow" 'pm2_env={"name":"sportflow-web","pm_id":6}'
  mkproc 1005 1000 0 "$CG_UNIT" "next-server (v16.4.5)" "name=jumuiya-staging-web"
  mkproc 1006 1001 0 "$CG_UNIT" "node helper.js" "name=naro-api"
  # the deploying SSH session
  mkproc 2000 1 0 "$CG_SSH" "-bash"
  printf '1000\n' > "$PMH/pm2.pid"
  mksock "$PMH/rpc.sock"
  mksock "$PMH/pub.sock"

  cat > "$T/unit.props" <<EOF
LoadState=loaded
ActiveState=active
SubState=running
MainPID=1000
ControlGroup=$CG_UNIT
PIDFile=$PMH/pm2.pid
Environment=PATH=/usr/bin:/bin PM2_HOME=$PMH
User=root
EOF
  cat > "$T/ss_unix" <<EOF
u_str LISTEN 0 511 $PMH/rpc.sock 31001 * 0 users:(("PM2 v6.0.14: Go",pid=1000,fd=23))
u_str LISTEN 0 511 $PMH/pub.sock 31002 * 0 users:(("PM2 v6.0.14: Go",pid=1000,fd=22))
u_str LISTEN 0 4096 /run/systemd/private 1234 * 0 users:(("systemd",pid=1,fd=40))
EOF
  cat > "$T/ss_tcp" <<EOF
LISTEN 0 511 *:4000 *:* users:(("PM2 v6.0.14: Go",pid=1000,fd=57))
LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("PM2 v6.0.14: Go",pid=1000,fd=59))
LISTEN 0 511 0.0.0.0:3001 0.0.0.0:* users:(("PM2 v6.0.14: Go",pid=1000,fd=60))
LISTEN 0 511 *:3200 *:* users:(("PM2 v6.0.14: Go",pid=1000,fd=61))
LISTEN 0 4096 127.0.0.1:14000 0.0.0.0:* users:(("node",pid=2000,fd=3))
LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))
EOF
}

setprop() { sed -i "s|^$1=.*|$1=$2|" "$T/unit.props"; }

# Fixture mutations (also usable from a delayed mutate.sh, see mutate_at)
MUT_DAEMON_DOWN="sed -i -e 's|^ActiveState=.*|ActiveState=inactive|' -e 's|^SubState=.*|SubState=dead|' -e 's|^MainPID=.*|MainPID=0|' '$T/unit.props'; rm -rf '$PROC/1000' '$PROC/1001' '$PROC/1002' '$PROC/1003'; : > '$T/ss_tcp'"
MUT_FOREIGN_3001="sed -i 's|0.0.0.0:3001 0.0.0.0:\\* users:((\"PM2 v6.0.14: Go\",pid=1000,fd=60))|0.0.0.0:3001 0.0.0.0:* users:((\"python3\",pid=2000,fd=5))|' '$T/ss_tcp'"

mutate_at() {
  # mutate_at <n> <shell snippet>: apply the snippet when the guard performs
  # its n-th check (each check calls `systemctl show` exactly once).
  printf '%s\n' "$1" > "$T/mutate_at"
  printf '%s\n' "$2" > "$T/mutate.sh"
}

mkdir -p "$BIN" "$BINF"
cat > "$BIN/fake-systemctl" <<EOF
#!/usr/bin/env bash
n=\$(( \$(cat "$T/sysctl_count" 2>/dev/null || echo 0) + 1 ))
echo "\$n" > "$T/sysctl_count"
if [ -f "$T/mutate_at" ] && [ "\$n" = "\$(cat "$T/mutate_at")" ]; then bash "$T/mutate.sh"; fi
cat "$T/unit.props"
EOF
cat > "$BIN/fake-ss" <<EOF
#!/usr/bin/env bash
case "\$*" in *x*) cat "$T/ss_unix" ;; *) cat "$T/ss_tcp" ;; esac
EOF
cat > "$BIN/pm2" <<EOF
#!/usr/bin/env bash
case "\$1" in
  reload|restart)
    echo "GIT_SHA=\${GIT_SHA:-} \$*" >> "$T/pm2_calls"
    [ -n "\${GIT_SHA:-}" ] && echo "\$GIT_SHA" > "$T/live_sha" ;;
  *) echo "\$*" >> "$T/pm2_calls" ;;
esac
exit 0
EOF

# --- flow decoys -------------------------------------------------------------
cat > "$BINF/pnpm" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$T/pnpm_calls"
if [ "\${1:-}" = "--filter" ] && [ "\${3:-}" = "build" ]; then
  app="\$2"; sha="\$(git -C "\$FAKE_APP" rev-parse HEAD)"; d="\$FAKE_APP/apps/\$app"
  [ -f "$T/hook_build_\$app" ] && bash "$T/hook_build_\$app"
  [ -f "$T/fail_build_\$app" ] && exit 1
  if [ "\$app" = "api" ]; then
    rm -rf "\$d/dist"; mkdir -p "\$d/dist"; echo "// \$sha" > "\$d/dist/main.js"
  else
    rm -rf "\$d/.next"
    mkdir -p "\$d/.next/static/css" "\$d/.next/standalone/apps/\$app/.next"
    echo "\$sha-\$app" > "\$d/.next/BUILD_ID"; echo '{}' > "\$d/.next/routes-manifest.json"
    echo x > "\$d/.next/static/css/app.css"; echo '//' > "\$d/.next/standalone/apps/\$app/server.js"
  fi
fi
exit 0
EOF
printf '#!/usr/bin/env bash\necho t\n' > "$BINF/psql"
printf '#!/usr/bin/env bash\necho "sudo $*" >> "%s/sudo_calls"\nexit 0\n' "$T" > "$BINF/sudo"
cat > "$BINF/curl" <<EOF
#!/usr/bin/env bash
url=""; wcode=0
for a in "\$@"; do case "\$a" in http*) url="\$a" ;; '%{http_code}') wcode=1 ;; esac; done
live="\$(cat "$T/live_sha" 2>/dev/null)"
healthy=1
[ -f "$T/all_unhealthy" ] && healthy=0
if [ -f "$T/bad_sha" ] && [ "\$live" = "\$(cat "$T/bad_sha")" ]; then healthy=0; fi
if [ "\$wcode" = 1 ]; then [ "\$healthy" = 1 ] && printf 200 || printf 503; exit 0; fi
case "\$url" in
  */api/v1/health) echo "{\"status\":\"ok\",\"commit\":\"\$live\"}" ;;
  *) echo '<link rel="stylesheet" href="/_next/static/css/app.css">' ;;
esac
EOF
cat > "$BINF/sleep" <<EOF
#!/usr/bin/env bash
echo \$(( \$(cat "$T/clock" 2>/dev/null || echo 0) + \${1%%.*} )) > "$T/clock"
EOF
cat > "$BINF/date" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "+%s" ]; then echo \$(( 1800000000 + \$(cat "$T/clock" 2>/dev/null || echo 0) )); exit 0; fi
exec "$REAL_DATE" "\$@"
EOF
chmod +x "$BIN"/* "$BINF"/*

# Safety: refuse to run unless every risky name resolves to its decoy.
for tool in pm2 pnpm psql sudo curl sleep date; do
  got="$(PATH="$BINF:$BIN:$PATH" command -v "$tool" || true)"
  case "$got" in
    "$BIN/$tool"|"$BINF/$tool") ;;
    *) echo "ABORT: '$tool' resolves to '${got:-nothing}', not its decoy — refusing to run." >&2; exit 2 ;;
  esac
done

# (PM2_GUARD_SOCKET_FLAG is passed separately: mksock may switch it to -e.)
GUARD_ENV=(PM2_GUARD_TEST=1 "PM2_GUARD_PROC_ROOT=$PROC" "PM2_GUARD_SYSTEMCTL=$BIN/fake-systemctl"
           "PM2_GUARD_SS=$BIN/fake-ss")

run_guard() {
  env PATH="$BIN:$PATH" "${GUARD_ENV[@]}" PM2_GUARD_SOCKET_FLAG="$SOCKFLAG" \
    PM2_GUARD_UID="${UID_OVERRIDE:-0}" PM2_HOME="${HOME_OVERRIDE:-$PMH}" APP_DIR="$REPO" \
    bash "$GUARD" > "$T/out" 2>&1
}

no_pm2_calls() { [ ! -s "$T/pm2_calls" ]; }

expect_pass() {
  local name="$1" want="${2:-}"
  if run_guard && no_pm2_calls && { [ -z "$want" ] || grep -qF -- "$want" "$T/out"; }; then
    ok "$name"
  else
    bad "$name (expected PASS${want:+ with '$want'})"; show "$T/out"
  fi
}

expect_fail() {
  local name="$1" want="$2"
  if ! run_guard && no_pm2_calls && grep -qF -- "$want" "$T/out"; then
    ok "$name"
  else
    bad "$name (expected FAIL with '$want')"; show "$T/out"
  fi
}

# ===========================================================================
echo "1) pm2-guard scenarios:"
# ===========================================================================
fresh; expect_pass "healthy supervised daemon passes" "PASSED (0 warning(s))"
fresh; expect_pass "port :14000 is not mistaken for :4000" "naro-api: 1/1 instance(s)"
fresh; expect_pass "other apps on the shared daemon are not counted as NARO" "naro-admin: 1/1 instance(s)"

fresh; setprop ActiveState inactive; setprop SubState dead; setprop MainPID 0
expect_fail "unit inactive -> refuse" "not active/running"

fresh; setprop LoadState not-found
expect_fail "unit not installed -> refuse" "not installed/loaded"

fresh; printf '0::%s\n' "$CG_SSH" > "$PROC/1000/cgroup"
expect_fail "daemon in an SSH session cgroup (unsupervised) -> refuse" "NOT systemd-supervised"

fresh; printf '4242\n' > "$PMH/pm2.pid"
expect_fail "pm2.pid != MainPID -> refuse" "not the one systemd supervises"

fresh; rm -rf "$PROC/1000"
expect_fail "daemon PID dead (stale) -> refuse" "is not running"

fresh; printf '%s\0' "node /usr/bin/something" > "$PROC/1000/cmdline"
expect_fail "MainPID is not a God Daemon (PID reuse) -> refuse" "is not a PM2 God Daemon"

fresh; printf '%s\0' "PM2 v6.0.14: God Daemon (/home/other/.pm2)" > "$PROC/1000/cmdline"
expect_fail "daemon serves another PM2_HOME -> refuse" "expected '$PMH'"

fresh; mkproc 3000 1 0 "$CG_SSH" "PM2 v6.0.14: God Daemon ($PMH)"
expect_fail "second root daemon (SSH session) -> refuse" "another root PM2 God Daemon"

fresh; mkproc 3001 1 999 /system.slice/pm2-kiuruwi.service "PM2 v6.0.14: God Daemon (/home/kiuruwi/.pm2)"
expect_pass "non-root daemon of another user (kiuruwi) -> warn only" "non-root PM2 daemon pid 3001"

fresh; mkproc 3002 2000 0 "$CG_SSH" "bash -c pgrep -f God Daemon"
expect_pass "a shell whose cmdline mentions 'God Daemon' is not a daemon" "no second root PM2 daemon"

fresh; sed -i "s|pid=1000,fd=23|pid=3000,fd=23|" "$T/ss_unix"
expect_fail "rpc.sock held by another process -> refuse" "rpc.sock is held by pid(s) '3000'"

fresh; echo "u_str LISTEN 0 511 $PMH/rpc.sock 39999 * 0 users:((\"PM2 v6.0.14: Go\",pid=3000,fd=9))" >> "$T/ss_unix"
expect_fail "duplicate listener bound at rpc.sock -> refuse" "rpc.sock: 2 listening sockets"

fresh; rm -f "$PMH/pub.sock"
expect_fail "pub.sock missing -> refuse" "pub.sock is missing"

fresh; bash -c "$MUT_FOREIGN_3001"
expect_fail "port occupied by a foreign process -> refuse" "naro-admin: :3001 is held by 2000"

fresh; echo 'LISTEN 0 511 [::]:4000 [::]:* users:(("node",pid=2000,fd=9))' >> "$T/ss_tcp"
expect_fail "duplicate listener on :4000 outside the daemon -> refuse" "naro-api: :4000 is held by 2000"

fresh; mkproc 3003 1 0 "$CG_SSH" "node server.js" "name=naro-admin" "pm_id=2"
expect_fail "unsupervised NARO process outside the unit -> refuse" "naro-admin process 3003 runs OUTSIDE"

fresh; mkproc 1007 1000 0 "$CG_UNIT" "node main.js" 'pm2_env={"name":"naro-api"}'
expect_fail "duplicate NARO instance (2 > ecosystem 1) -> refuse" "naro-api: 2 instances"

fresh; sed -i '/:3001 /d' "$T/ss_tcp"; rm -rf "$PROC/1003"
expect_pass "legitimately stopped app under a healthy daemon -> warn, allowed" "nothing listening on :3001"

UID_OVERRIDE=1000; fresh
expect_fail "non-root caller -> refuse" "not root"
unset UID_OVERRIDE

HOME_OVERRIDE="/home/deploy/.pm2"; fresh
expect_fail "CLI PM2_HOME differs from the unit -> refuse" "would start a second daemon"
unset HOME_OVERRIDE

fresh
if env -u PM2_GUARD_TEST PATH="$BIN:$PATH" PM2_GUARD_PROC_ROOT="$PROC" \
     PM2_GUARD_SYSTEMCTL="$BIN/fake-systemctl" PM2_GUARD_SS="$BIN/fake-ss" PM2_GUARD_UID=0 \
     PM2_HOME="$PMH" APP_DIR="$REPO" bash "$GUARD" > "$T/out" 2>&1; then
  bad "overrides must be ignored without PM2_GUARD_TEST=1 (guard passed against fakes)"
else
  ok "test overrides ignored without PM2_GUARD_TEST=1"
fi

# ===========================================================================
echo "2) deploy-lib wiring:"
# ===========================================================================
lib_run() {
  # lib_run <command...> inside a subshell that sourced deploy-lib.sh
  ( cd "$REPO" && export PATH="$BIN:$PATH" "${GUARD_ENV[@]}" PM2_GUARD_UID=0 \
      PM2_GUARD_SOCKET_FLAG="$SOCKFLAG" PM2_HOME="$PMH" APP_DIR="$REPO"
    set -euo pipefail
    # shellcheck source=scripts/ops/deploy-lib.sh
    . scripts/ops/deploy-lib.sh
    "$@" ) > "$T/out" 2>&1
}

fresh
if lib_run reload_pm2 abc1234 \
   && [ "$(cat "$T/pm2_calls")" = "GIT_SHA=abc1234 reload ecosystem.config.js --only naro-api --update-env
GIT_SHA=abc1234 restart ecosystem.config.js --only naro-storefront,naro-admin --update-env
save" ]; then
  ok "reload_pm2 runs exactly the 3 named NARO pm2 commands when supervised"
else
  bad "reload_pm2 healthy path"; show "$T/out"; show "$T/pm2_calls"
fi

fresh; setprop ActiveState inactive; setprop MainPID 0
if ! lib_run reload_pm2 abc1234 && no_pm2_calls && grep -q "PM2 NOT reloaded" "$T/out"; then
  ok "reload_pm2 refuses and runs NO pm2 command when the daemon is down"
else
  bad "reload_pm2 must refuse without calling pm2"; show "$T/out"
fi

fresh; mutate_at 3 "$MUT_DAEMON_DOWN"   # check 1 = reload_pm2, 2 = before reload, 3 = before restart
if ! lib_run reload_pm2 abc1234 && [ "$(wc -l < "$T/pm2_calls" | tr -d ' ')" = "1" ] \
   && grep -q "PM2 only PARTLY reloaded" "$T/out"; then
  ok "daemon vanishing between pm2 commands stops before the next one (no respawn)"
else
  bad "pm2_guarded must re-check before every pm2 command"; show "$T/out"; show "$T/pm2_calls" 2>/dev/null
fi

fresh; printf '0::%s\n' "$CG_SSH" > "$PROC/1000/cgroup"
if lib_run pm2_diagnostics && no_pm2_calls && grep -q "skipping 'pm2 status'" "$T/out"; then
  ok "pm2_diagnostics skips pm2 status/logs when unsupervised"
else
  bad "pm2_diagnostics must not call pm2 when unsupervised"; show "$T/out"
fi

fresh; setprop ActiveState inactive; setprop MainPID 0
if lib_run print_db_rollback_help /x.dump && no_pm2_calls && grep -q "pm2 restart naro-api naro-admin naro-storefront" "$T/out" \
   && lib_run rollback_incomplete_notice abc1234 && no_pm2_calls && grep -q "ROLLBACK INCOMPLETE" "$T/out"; then
  ok "rollback help + incomplete notice only PRINT text (no pm2 executed)"
else
  bad "rollback help text executed a command"; show "$T/out"; show "$T/pm2_calls" 2>/dev/null
fi

# ===========================================================================
echo "3) deploy / rollback flows (real deploy.sh + rollback.sh, fake repo):"
# ===========================================================================
if [ "${PM2_GUARD_TEST_SKIP_FLOWS:-}" = "1" ]; then
  echo "  SKIPPED (PM2_GUARD_TEST_SKIP_FLOWS=1 — local quick run only; CI always runs the flows)"
else
A="$T/app"
O="$T/origin.git"

rewrite() {
  # rewrite <src> <dst> <from> <to>: literal one-line rewrite, must match once
  local n
  n="$(grep -cxF -- "$3" "$1")"
  if [ "$n" != "1" ]; then echo "ABORT: expected exactly one line '$3' in $1 (found $n)" >&2; exit 2; fi
  awk -v from="$3" -v to="$4" '$0 == from { print to; next } { print }' "$1" > "$2"
}

fake_build() {
  # fake_build <app> <sha>: an existing (live) build on disk
  local app="$1" sha="$2" d="$A/apps/$1"
  if [ "$app" = api ]; then
    mkdir -p "$d/dist"; echo "// $sha" > "$d/dist/main.js"
  else
    mkdir -p "$d/.next/static/css" "$d/.next/standalone/apps/$app/.next" "$d/.next/cache"
    echo "$sha-$app" > "$d/.next/BUILD_ID"; echo '{}' > "$d/.next/routes-manifest.json"
    echo x > "$d/.next/static/css/app.css"; echo '//' > "$d/.next/standalone/apps/$app/server.js"
  fi
}

make_app() {
  rm -rf "$A" "$O" "$T/pnpm_calls" "$T/sudo_calls" "$T/clock" "$T/bad_sha" "$T/all_unhealthy" "$T"/fail_build_* "$T"/hook_build_*
  git init -q --bare "$O"
  git init -q "$A"
  g() { git -C "$A" -c user.name=t -c user.email=t@t -c core.autocrlf=false "$@"; }
  mkdir -p "$A/scripts/ops" "$A/packages/database/prisma/migrations/0_init" "$A/apps/api" "$A/apps/storefront" "$A/apps/admin"
  rewrite "$REPO/deploy.sh" "$A/deploy.sh" 'APP_DIR="/var/www/naro-fashion"' 'APP_DIR="$FAKE_APP"'
  rewrite "$A/deploy.sh" "$A/deploy.sh.tmp" 'unset PM2_GUARD_TEST' ': # test harness keeps PM2_GUARD_TEST'
  mv "$A/deploy.sh.tmp" "$A/deploy.sh"
  rewrite "$REPO/scripts/ops/rollback.sh" "$A/scripts/ops/rollback.sh" 'unset PM2_GUARD_TEST' ': # test harness keeps PM2_GUARD_TEST'
  cp "$REPO/scripts/ops/deploy-lib.sh" "$REPO/scripts/ops/pm2-guard.sh" "$A/scripts/ops/"
  cp "$REPO/ecosystem.config.js" "$A/"
  cat > "$A/scripts/ops/pg-backup.sh" <<'EOS'
#!/usr/bin/env bash
f="$FAKE_T/predeploy-${BACKUP_TAG:-x}.dump"; echo dump > "$f"
[ -n "${BACKUP_RESULT_FILE:-}" ] && echo "$f" > "$BACKUP_RESULT_FILE"
exit 0
EOS
  echo "-- 0_init" > "$A/packages/database/prisma/migrations/0_init/migration.sql"
  printf 'apps/*/.next*\napps/api/dist*\n.deploy/\n' > "$A/.gitignore"
  printf '* -text\n' > "$A/.gitattributes"
  touch "$A/apps/api/.keep" "$A/apps/storefront/.keep" "$A/apps/admin/.keep"
  echo 1 > "$A/VERSION"
  if [ "${PRE_GUARD_V1:-}" = "1" ]; then
    # v1 = a commit from BEFORE the guard existed: no pm2-guard.sh, old tooling
    rm -f "$A/scripts/ops/pm2-guard.sh"
    echo "# OLD-TOOLING-MARKER" >> "$A/scripts/ops/deploy-lib.sh"
    echo "# OLD-TOOLING-MARKER" >> "$A/scripts/ops/rollback.sh"
  fi
  g add -A && g commit -qm v1 && g branch -M prod && g remote add origin "$O" && g push -q origin prod
  V1="$(g rev-parse HEAD)"
  echo 2 > "$A/VERSION"
  # v2 = guarded tooling (current scripts)
  rewrite "$REPO/scripts/ops/rollback.sh" "$A/scripts/ops/rollback.sh" 'unset PM2_GUARD_TEST' ': # test harness keeps PM2_GUARD_TEST'
  cp "$REPO/scripts/ops/deploy-lib.sh" "$REPO/scripts/ops/pm2-guard.sh" "$A/scripts/ops/"
  g add -A && g commit -qm v2 && g push -q origin prod
  V2="$(g rev-parse HEAD)"
  g reset -q --hard "$V1"
  g fetch -q origin
  for app in api storefront admin; do fake_build "$app" "$V1"; done
  mkdir -p "$A/.deploy"; echo "$V1" > "$A/.deploy/current_sha"
  echo "$V1" > "$T/live_sha"
  rm -f "$T/pm2_calls" "$T/sysctl_count"
}

ci_reset() {
  # What the CI deploy step does before deploy.sh: refresh the checkout.
  git -C "$A" fetch -q origin prod && git -C "$A" checkout -q -f prod && git -C "$A" reset -q --hard origin/prod
}

guard_kept() {
  # the checkout's deploy tooling is the guarded (v2/current) version
  [ -f "$A/scripts/ops/pm2-guard.sh" ] && cmp -s "$A/scripts/ops/pm2-guard.sh" "$REPO/scripts/ops/pm2-guard.sh"     && ! grep -q OLD-TOOLING-MARKER "$A/scripts/ops/deploy-lib.sh" "$A/scripts/ops/rollback.sh"
}

FLOW_ENV=()
run_flow() {
  # run_flow <script> [args]: run deploy.sh / rollback.sh against the fakes
  ( cd "$A" && env PATH="$BINF:$BIN:$PATH" "${GUARD_ENV[@]}" PM2_GUARD_SOCKET_FLAG="$SOCKFLAG" PM2_GUARD_UID=0 \
      PM2_HOME="$PMH" APP_DIR="$A" FAKE_APP="$A" FAKE_T="$T" PGPASSFILE=/dev/null \
      "${FLOW_ENV[@]}" bash "$@" ) > "$T/out" 2>&1
}
deploy() { FLOW_ENV=("EXPECTED_SHA=$V2"); run_flow "$A/deploy.sh"; }
rollback() { FLOW_ENV=(); run_flow "$A/scripts/ops/rollback.sh" --yes; }

head_is() { [ "$(git -C "$A" rev-parse HEAD)" = "$1" ]; }
builds_are() {
  [ "$(cat "$A/apps/storefront/.next/BUILD_ID")" = "$1-storefront" ] \
    && [ "$(cat "$A/apps/admin/.next/BUILD_ID")" = "$1-admin" ] \
    && grep -q "$1" "$A/apps/api/dist/main.js"
}
live_is() { [ "$(cat "$T/live_sha")" = "$1" ]; }
pm2_lines() { if [ -s "$T/pm2_calls" ]; then wc -l < "$T/pm2_calls" | tr -d ' '; else echo 0; fi; }
no_restart_all() { ! grep -qwE 'all' "$T/pm2_calls" 2>/dev/null; }
expect_pm2() { [ "$(cat "$T/pm2_calls" 2>/dev/null)" = "$1" ]; }

pm2_reload_set() {
  printf 'GIT_SHA=%s reload ecosystem.config.js --only naro-api --update-env\nGIT_SHA=%s restart ecosystem.config.js --only naro-storefront,naro-admin --update-env\nsave' "$1" "$1"
}

flow_result() {
  # flow_result <name> <condition-result>
  if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; show "$T/out" 50; echo "        pm2 calls:"; show "$T/pm2_calls" 2>/dev/null; fi
}

# A. normal deploy
fresh; make_app; deploy; rc=$?
c=1; [ "$rc" = 0 ] && head_is "$V2" && builds_are "$V2" && live_is "$V2" && expect_pm2 "$(pm2_reload_set "$V2")" \
  && [ "$(cat "$A/.deploy/current_sha")" = "$V2" ] && [ "$(cat "$A/.deploy/previous_sha")" = "$V1" ] && c=0
flow_result "normal deploy: exit 0, v2 live, only the 3 named NARO pm2 commands" "$c"

# B. failed build -> nothing reloaded, live build restored
fresh; make_app; touch "$T/fail_build_storefront"; deploy; rc=$?
c=1; [ "$rc" != 0 ] && [ "$(pm2_lines)" = 0 ] && builds_are "$V1" && live_is "$V1" && grep -q "pre-build copies restored" "$T/out" && c=0
flow_result "failed deployment (build error): non-zero, NO pm2 call, v1 builds restored" "$c"

# C. unhealthy release -> automatic rollback
fresh; make_app; echo "$V2" > "$T/bad_sha"; deploy; rc=$?
c=1; [ "$rc" = 1 ] && head_is "$V1" && builds_are "$V1" && live_is "$V1" && no_restart_all \
  && expect_pm2 "$(pm2_reload_set "$V2")
status
logs --nostream --lines 40
$(pm2_reload_set "$V1")" \
  && grep -q "Rollback COMPLETE and healthy" "$T/out" && [ "$(cat "$A/.deploy/rolled_back_from")" = "$V2" ] && c=0
flow_result "automatic rollback: exit 1, v1 restored + reloaded, never 'restart all'" "$c"

# D. manual rollback after a good deploy
fresh; make_app; deploy; rm -f "$T/pm2_calls"; rollback; rc=$?
c=1; [ "$rc" = 0 ] && head_is "$V1" && builds_are "$V1" && live_is "$V1" && expect_pm2 "$(pm2_reload_set "$V1")" && c=0
flow_result "manual rollback: exit 0, v1 restored, only the 3 named NARO pm2 commands" "$c"

# E. daemon unavailable before the deploy
fresh; bash -c "$MUT_DAEMON_DOWN"; make_app; deploy; rc=$?
c=1; [ "$rc" != 0 ] && [ "$(pm2_lines)" = 0 ] && head_is "$V1" && builds_are "$V1" && [ ! -s "$T/pnpm_calls" ] \
  && grep -q "nothing was changed" "$T/out" && c=0
flow_result "daemon down before deploy: refused at stage 0, NO pm2/git/pnpm change" "$c"

# F. daemon disappears during the build (2nd check = before the swap)
fresh; make_app; mutate_at 2 "$MUT_DAEMON_DOWN"; deploy; rc=$?
c=1; [ "$rc" != 0 ] && [ "$(pm2_lines)" = 0 ] && builds_are "$V1" && [ "$(cat "$A/.deploy/current_sha")" = "$V1" ] \
  && grep -q "NOT swapping or reloading" "$T/out" && c=0
flow_result "daemon lost during build: refused before swap, v1 builds restored, NO pm2" "$c"

# G. daemon disappears after the swap (3rd check = inside reload_pm2)
fresh; make_app; mutate_at 3 "$MUT_DAEMON_DOWN"; deploy; rc=$?
c=1; [ "$rc" = 3 ] && [ "$(pm2_lines)" = 0 ] && head_is "$V1" && builds_are "$V1" \
  && grep -q "ROLLBACK INCOMPLETE" "$T/out" && c=0
flow_result "daemon lost after swap: files rolled back, NO pm2, exit 3 = ROLLBACK INCOMPLETE" "$c"

# H. daemon dies between 'reload naro-api' and 'restart next apps'
fresh; make_app; mutate_at 5 "$MUT_DAEMON_DOWN"; deploy; rc=$?
c=1; [ "$rc" = 3 ] && [ "$(pm2_lines)" = 1 ] && grep -q "reload ecosystem.config.js --only naro-api" "$T/pm2_calls" \
  && head_is "$V1" && builds_are "$V1" && grep -q "ROLLBACK INCOMPLETE" "$T/out" && c=0
flow_result "daemon lost mid-reload: next pm2 command refused, rollback INCOMPLETE (exit 3)" "$c"

# I. one NARO app legitimately stopped
fresh; sed -i '/:3001 /d' "$T/ss_tcp"; rm -rf "$PROC/1003"; make_app; deploy; rc=$?
c=1; [ "$rc" = 0 ] && live_is "$V2" && expect_pm2 "$(pm2_reload_set "$V2")" && grep -q "nothing listening on :3001" "$T/out" && c=0
flow_result "deploy while naro-admin is stopped: allowed (warning), PM2 starts it" "$c"

fresh; sed -i '/:3001 /d' "$T/ss_tcp"; rm -rf "$PROC/1003"; make_app; echo "$V2" > "$T/bad_sha"; deploy; rc=$?
c=1; [ "$rc" = 1 ] && head_is "$V1" && builds_are "$V1" && live_is "$V1" && no_restart_all && grep -q "Rollback COMPLETE and healthy" "$T/out" && c=0
flow_result "failure + rollback while naro-admin is stopped: rollback completes" "$c"

# J. port occupied by an unexpected process
fresh; bash -c "$MUT_FOREIGN_3001"; make_app; deploy; rc=$?
c=1; [ "$rc" != 0 ] && [ "$(pm2_lines)" = 0 ] && head_is "$V1" && builds_are "$V1" && grep -q ":3001 is held by 2000" "$T/out" && c=0
flow_result "foreign process on :3001 before deploy: refused, nothing changed" "$c"

fresh; make_app; echo "$V2" > "$T/bad_sha"; mutate_at 7 "$MUT_FOREIGN_3001"; deploy; rc=$?
c=1; [ "$rc" = 3 ] && head_is "$V1" && builds_are "$V1" && expect_pm2 "$(pm2_reload_set "$V2")" \
  && grep -q "skipping 'pm2 status'" "$T/out" && grep -q "ROLLBACK INCOMPLETE" "$T/out" && c=0
flow_result "foreign listener appears during a failing release: rollback restores files, NO pm2, exit 3" "$c"

# K. manual rollback refused / blocked
fresh; make_app; deploy; rm -f "$T/pm2_calls"; bash -c "$MUT_DAEMON_DOWN"; rollback; rc=$?
c=1; [ "$rc" = 1 ] && [ "$(pm2_lines)" = 0 ] && builds_are "$V2" && [ -f "$A/.deploy/previous_sha" ] \
  && grep -q "nothing was changed" "$T/out" && c=0
flow_result "manual rollback with daemon down: refused up front, nothing swapped" "$c"

fresh; make_app; deploy; rm -f "$T/pm2_calls" "$T/sysctl_count"; mutate_at 2 "$MUT_DAEMON_DOWN"; rollback; rc=$?
c=1; [ "$rc" = 3 ] && [ "$(pm2_lines)" = 0 ] && head_is "$V1" && builds_are "$V1" && grep -q "ROLLBACK INCOMPLETE" "$T/out" && c=0
flow_result "manual rollback, daemon lost before reload: files restored, NO pm2, exit 3" "$c"

# L. rollback targets that PREDATE the guard keep the guard
fresh; PRE_GUARD_V1=1 make_app; ci_reset; echo "$V2" > "$T/bad_sha"; deploy; rc=$?
c=1; [ "$rc" = 1 ] && head_is "$V1" && [ "$(cat "$A/VERSION")" = 1 ] && builds_are "$V1" && live_is "$V1" && guard_kept   && [ "$(cat "$A/.deploy/tooling_from")" = "$V2" ] && no_restart_all && grep -q "Rollback COMPLETE and healthy" "$T/out" && c=0
flow_result "auto rollback to a pre-guard commit: app code v1, guard tooling KEPT, complete" "$c"

fresh; PRE_GUARD_V1=1 make_app; ci_reset; deploy; rm -f "$T/pm2_calls"; rollback; rc=$?
c=1; [ "$rc" = 0 ] && head_is "$V1" && [ "$(cat "$A/VERSION")" = 1 ] && builds_are "$V1" && guard_kept   && expect_pm2 "$(pm2_reload_set "$V1")" && grep -q "predates the PM2 guard" "$T/out" && c=0
flow_result "manual rollback to a pre-guard commit: app code v1, guard tooling KEPT" "$c"

# M. never report a partial rollback as successful
fresh; make_app; touch "$T/all_unhealthy"; deploy; rc=$?
c=1; [ "$rc" = 3 ] && builds_are "$V1" && grep -q "the restored build is NOT healthy" "$T/out"   && ! grep -q "Rollback COMPLETE" "$T/out" && no_restart_all && c=0
flow_result "rollback whose restored build is unhealthy: exit 3 INCOMPLETE, never 'COMPLETE'" "$c"

fresh; make_app; deploy; rm -f "$T/pm2_calls"; touch "$T/all_unhealthy"; rollback; rc=$?
c=1; [ "$rc" = 3 ] && builds_are "$V1" && grep -q "ROLLBACK INCOMPLETE" "$T/out" && ! grep -q "Rollback COMPLETE" "$T/out" && c=0
flow_result "manual rollback, restored build unhealthy: exit 3 INCOMPLETE" "$c"

fresh; make_app; echo "$V2" > "$T/bad_sha"; echo 'rm -rf "$FAKE_APP/apps/admin/.next-prev.pending"' > "$T/hook_build_admin"; deploy; rc=$?
c=1; [ "$rc" = 3 ] && grep -q "ROLLBACK NOT PERFORMED" "$T/out" && ! grep -q "^GIT_SHA=$V1 " "$T/pm2_calls"   && ! grep -q "Rollback COMPLETE" "$T/out" && c=0
flow_result "no previous build to restore: exit 3 ROLLBACK NOT PERFORMED, no reload of anything" "$c"

if [ -f "$T/sudo_calls" ]; then bad "flows must never reach sudo (baseline path)"; show "$T/sudo_calls"; else ok "no flow invoked sudo / database baseline"; fi

fi  # PM2_GUARD_TEST_SKIP_FLOWS
# ===========================================================================
echo "4) static invariants:"
# ===========================================================================
if grep -vE '^[[:space:]]*#' "$GUARD" | grep -nE '(^|[;&|(`]|\$\()[[:space:]]*pm2[[:space:]]'; then
  bad "pm2-guard.sh must never invoke pm2"
else
  ok "pm2-guard.sh never invokes pm2"
fi

# Every pm2 command line in the deploy scripts (outside heredocs/comments)
# must live in pm2_guarded or pm2_diagnostics, which run the guard first.
stray="$(awk '
  FNR == 1 { fn = ""; hd = "" }
  hd != "" { if ($0 == hd) hd = ""; next }
  /<<-?[[:space:]]*'\''?[A-Z_]+'\''?/ { match($0, /<<-?[[:space:]]*'\''?[A-Z_]+/); t = substr($0, RSTART, RLENGTH); gsub(/[<>\-'\'' ]/, "", t); hd = t }
  /^[a-z_0-9]+\(\)[[:space:]]*\{/ { fn = $1; sub(/\(\).*/, "", fn) }
  /^\}/ { fn = "" }
  /^[[:space:]]*#/ { next }
  /^[[:space:]]*(GIT_SHA="[^"]*"[[:space:]]+)?pm2[[:space:]]/ {
    if (fn != "pm2_guarded" && fn != "pm2_diagnostics") print FILENAME ":" FNR ": " $0
  }' "$REPO/deploy.sh" "$REPO/scripts/ops/deploy-lib.sh" "$REPO/scripts/ops/rollback.sh")"
if [ -n "$stray" ]; then
  bad "unguarded pm2 call(s):"; printf '        %s\n' "$stray"
else
  ok "every pm2 call in deploy.sh / deploy-lib.sh / rollback.sh is behind the guard"
fi

# No pm2 command (guarded or not) may target 'all' — the daemon is shared.
alls="$(grep -nE '^[[:space:]]*(GIT_SHA="[^"]*"[[:space:]]+)?pm2(_guarded)?[[:space:]].*[[:space:]]all([[:space:]]|$)' \
  "$REPO/deploy.sh" "$REPO/scripts/ops/deploy-lib.sh" "$REPO/scripts/ops/rollback.sh")"
if [ -n "$alls" ]; then bad "pm2 command targets 'all':"; printf '        %s\n' "$alls"; else ok "no pm2 command targets 'all'"; fi

# Backticks or $( inside an UNQUOTED heredoc are command substitution: the
# rollback help text once executed `pm2 restart all` this way.
subs="$(awk '
  FNR == 1 { hd = "" }
  hd != "" { if ($0 == hd) hd = ""; else if (index($0, "`") > 0 || index($0, "$(") > 0) print FILENAME ":" FNR ": " $0; next }
  /<<-?[[:space:]]*[A-Z_]+/ && !/<<-?[[:space:]]*['\''"]/ {
    match($0, /<<-?[[:space:]]*[A-Z_]+/); t = substr($0, RSTART, RLENGTH); gsub(/[<\- ]/, "", t); hd = t
  }' "$REPO/deploy.sh" "$REPO"/scripts/ops/*.sh)"
if [ -n "$subs" ]; then
  bad "command substitution inside unquoted heredocs (it executes):"; printf '        %s\n' "$subs"
else
  ok "no command substitution inside unquoted heredocs in deploy/ops scripts"
fi

if grep -qxF 'unset PM2_GUARD_TEST' "$REPO/deploy.sh" && grep -qxF 'unset PM2_GUARD_TEST' "$REPO/scripts/ops/rollback.sh"; then
  ok "deploy.sh and rollback.sh unset PM2_GUARD_TEST (test overrides can't reach prod)"
else
  bad "deploy.sh / rollback.sh must 'unset PM2_GUARD_TEST'"
fi

echo ""
echo "pm2-guard tests: ${PASS} passed, ${FAIL} failed (socket check flag: ${SOCKFLAG})"
[ "$FAIL" -eq 0 ]
